import {realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {
	app,
	BrowserWindow,
	dialog,
	type MessageBoxOptions,
	type OpenDialogOptions,
} from 'electron';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {registerHandler} from '@/main/ipc/register';
import {registerWorkspaceHandlers} from '@/main/ipc/workspace';
import type {WorkspaceServices} from '@/main/ipc/workspace-services';
import {disposeDesktop} from '@/main/lifecycle';
import {
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import {openProject} from '@/main/nanocoder/open-project';
import {PermissionBroker} from '@/main/nanocoder/permissions';
import {resolveNanocoder} from '@/main/nanocoder/runtime';
import {createLookup} from '@/main/nanocoder/runtime-lookup';
import type {TrustReason, TrustRefusal} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import {isAllowedOrigin} from '@/main/security';
import {APP_NAME} from '@/shared/app-info';
import {
	type AppInfo,
	CHANNELS,
	type ConnectResult,
	type NanocoderMode,
	type NanocoderRuntime,
	type SessionInfo,
	type TurnEvent,
	type TurnResult,
} from '@/shared/ipc';

const DEFAULT_MODE: NanocoderMode = 'normal';

const TRUST_TITLES: Record<TrustReason, string> = {
	'not-trusted': 'Trust this folder?',
	changed: 'Trust this changed folder?',
	'needs-re-approval': 'Approve this folder again?',
};

const lookupRuntime = createLookup(() =>
	resolveNanocoder({
		env: process.env,
		platform: process.platform,
		untrustedRoots: [],
	}),
);
let connection: NanocoderConnection | undefined;
let session: SessionInfo | undefined;
let connecting = false;
// The turn in flight, if any. A new connection drops it, so a stale turn cannot block the next one.
let activeTurn: object | undefined;
let appOrigins: readonly string[] = [];
let workspaceServices: WorkspaceServices = {};
let unsubscribeProjectEvents: (() => void) | undefined;

// Only windows showing the app get events; the renderer never sees the IPC event object.
function sendEvent(event: TurnEvent): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (isAllowedOrigin(window.webContents.getURL(), appOrigins)) {
			window.webContents.send(CHANNELS.nanocoderEvent, event);
		}
	}
}

const permissions = new PermissionBroker(sendEvent);

function forget(next: NanocoderConnection): void {
	if (connection !== next) return;
	connection = undefined;
	session = undefined;
	activeTurn = undefined;
	permissions.cancelAll();
}

async function nanocoderRuntime(): Promise<NanocoderRuntime> {
	const resolution = await lookupRuntime();
	if (!resolution.ok) {
		throw new IpcFailure(resolution.code, resolution.message);
	}
	return resolution.runtime;
}

async function chooseProjectRoot(): Promise<string | undefined> {
	const options: OpenDialogOptions = {
		title: 'Open a project folder',
		properties: ['openDirectory'],
	};
	const window = BrowserWindow.getFocusedWindow();
	const picked = window
		? await dialog.showOpenDialog(window, options)
		: await dialog.showOpenDialog(options);
	const [folder] = picked.filePaths;
	return picked.canceled || !folder ? undefined : realpath(folder);
}

// A native dialog in main, so the renderer can never grant trust on the user's behalf.
async function confirmTrust(refusal: TrustRefusal): Promise<boolean> {
	const options: MessageBoxOptions = {
		type: 'question',
		title: TRUST_TITLES[refusal.reason],
		message: refusal.summary,
		detail:
			"Trusting it lets Nanocoder load this folder's own configuration, hooks, MCP servers and plugins, which can run code on this computer.",
		buttons: ['Trust folder', 'Cancel'],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	};
	const window = BrowserWindow.getFocusedWindow();
	const {response} = window
		? await dialog.showMessageBox(window, options)
		: await dialog.showMessageBox(options);
	return response === 0;
}

async function connect(): Promise<ConnectResult> {
	if (connecting) {
		throw new IpcFailure('BUSY', 'Already connecting to Nanocoder', true);
	}
	connecting = true;
	try {
		const root = await chooseProjectRoot();
		if (!root) return {status: 'cancelled'};
		const resolved = await nanocoderRuntime();
		permissions.cancelAll();
		await connection?.close();
		connection = undefined;
		session = undefined;
		activeTurn = undefined;
		const outcome = await openProject({
			runtime: resolved,
			root,
			clientInfo: {
				name: 'nanocoder-desktop',
				title: APP_NAME,
				version: app.getVersion(),
			},
			homeDir: homedir(),
			mode: DEFAULT_MODE,
			confirmTrust,
			onUpdate: update => {
				const event = toTurnEvent(update);
				if (event) sendEvent(event);
			},
			onPermission: request => permissions.request(request),
		}).catch((error: unknown) => {
			if (error instanceof NanocoderFailure) {
				throw new IpcFailure(
					error.code,
					error.message,
					error.code === 'AGENT_UNAVAILABLE',
				);
			}
			throw error;
		});
		if (outcome.status === 'untrusted') return outcome;
		const next = outcome.connection;
		connection = next;
		session = outcome.session;
		void next.exited.then(() => forget(next));
		return {status: 'connected', agent: next.agent, session: outcome.session};
	} finally {
		connecting = false;
	}
}

async function sendPrompt({text}: {text: string}): Promise<TurnResult> {
	if (!connection || !session) {
		throw new IpcFailure('AGENT_UNAVAILABLE', 'No project is open');
	}
	if (activeTurn) {
		throw new IpcFailure(
			'BUSY',
			'Nanocoder is already working on a turn',
			true,
		);
	}
	const turn = {};
	activeTurn = turn;
	try {
		return await connection.prompt(session.id, text).catch((error: unknown) => {
			if (error instanceof NanocoderFailure) {
				throw new IpcFailure(error.code, error.message);
			}
			throw error;
		});
	} finally {
		if (activeTurn === turn) activeTurn = undefined;
	}
}

function answerPermission({
	id,
	optionId,
}: {
	id: string;
	optionId: string;
}): null {
	if (!permissions.answer(id, optionId)) {
		throw new IpcFailure(
			'NOT_FOUND',
			'That permission request is no longer waiting',
		);
	}
	return null;
}

export function closeNanocoder(): Promise<void> {
	return disposeDesktop({
		unsubscribe: unsubscribeProjectEvents,
		cancelPermissions: () => permissions.cancelAll(),
		supervisor: workspaceServices.supervisor,
		connection,
		store: workspaceServices.store,
	});
}

export function registerIpcHandlers(
	allowedOrigins: readonly string[],
	services: WorkspaceServices = {},
): void {
	appOrigins = allowedOrigins;
	workspaceServices = services;
	registerWorkspaceHandlers(registerHandler, allowedOrigins, services);
	unsubscribeProjectEvents = services.supervisor?.subscribe(event => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (isAllowedOrigin(window.webContents.getURL(), appOrigins)) {
				window.webContents.send(CHANNELS.projectEvent, event);
			}
		}
	});
	registerHandler(
		CHANNELS.getAppInfo,
		z.strictObject({}),
		(): AppInfo => ({name: APP_NAME, version: app.getVersion()}),
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.getNanocoderRuntime,
		z.strictObject({}),
		nanocoderRuntime,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.connectNanocoder,
		z.strictObject({}),
		connect,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.sendPrompt,
		z.strictObject({text: z.string().trim().min(1).max(100_000)}),
		sendPrompt,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.answerPermission,
		z.strictObject({id: z.string().max(64), optionId: z.string().max(200)}),
		answerPermission,
		allowedOrigins,
	);
}
