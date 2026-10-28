import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {
	app,
	BrowserWindow,
	dialog,
	type MessageBoxOptions,
	type OpenDialogOptions,
	type WebContents,
} from 'electron';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {registerHandler} from '@/main/ipc/register';
import {registerWorkspaceHandlers} from '@/main/ipc/workspace';
import type {WorkspaceServices} from '@/main/ipc/workspace-services';
import {disposeDesktop} from '@/main/lifecycle';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {resolveNanocoder} from '@/main/nanocoder/runtime';
import {createLookup} from '@/main/nanocoder/runtime-lookup';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {
	prepareSession,
	stopDetachedTurns,
} from '@/main/nanocoder/technical-sessions';
import type {TrustReason, TrustRefusal} from '@/main/nanocoder/trust';
import {canonicalPath} from '@/main/paths';
import {isAllowedOrigin} from '@/main/security';
import {APP_NAME} from '@/shared/app-info';
import {
	type AppInfo,
	CHANNELS,
	type ConnectResult,
	type NanocoderRuntime,
	type ProjectInfo,
	type SessionInfo,
	type TurnEvent,
	type TurnResult,
} from '@/shared/ipc';

const TRUST_TITLES: Record<TrustReason, string> = {
	'not-trusted': 'Trust this folder?',
	changed: 'Trust this changed folder?',
	'needs-re-approval': 'Approve this folder again?',
};

const runtimeDiscovery = new AbortController();
const lookupRuntime = createLookup(() =>
	resolveNanocoder({
		env: process.env,
		platform: process.platform,
		untrustedRoots: [...technicalProjects.keys()],
		signal: runtimeDiscovery.signal,
	}),
);
let supervisor: ProjectSupervisor | undefined;
let activeProjectId: string | undefined;
let session: SessionInfo | undefined;
let connecting = false;
let rendererCleanup: Promise<void> = Promise.resolve();
const technicalProjects = new Map<string, ProjectInfo>();
const technicalSessions = new Map<string, SessionInfo>();
let appOrigins: readonly string[] = [];
let workspaceServices: WorkspaceServices = {};
let unsubscribeProjectEvents: (() => void) | undefined;

// Only windows showing the app get events; the renderer never sees the IPC event object.
function sendEvent(event: TurnEvent): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (
			!window.webContents.isDestroyed() &&
			isAllowedOrigin(window.webContents.getURL(), appOrigins)
		) {
			window.webContents.send(CHANNELS.nanocoderEvent, event);
		}
	}
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
	return picked.canceled || !folder ? undefined : canonicalPath(folder);
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
	if (runtimeDiscovery.signal.aborted || !supervisor) {
		throw new IpcFailure(
			'AGENT_UNAVAILABLE',
			'The desktop cannot start a project now',
		);
	}
	if (connecting) {
		throw new IpcFailure('BUSY', 'Already connecting to Nanocoder', true);
	}
	connecting = true;
	try {
		const root = await chooseProjectRoot();
		if (!root) return {status: 'cancelled'};
		await rendererCleanup;
		if (runtimeDiscovery.signal.aborted)
			throw new IpcFailure('AGENT_UNAVAILABLE', 'The desktop is shutting down');
		activeProjectId = undefined;
		session = undefined;
		let project = technicalProjects.get(root);
		if (!project) {
			const now = new Date().toISOString();
			project = {
				id: randomUUID(),
				canonicalRoot: root,
				sessionCwd: root,
				displayName: path.basename(root),
				trusted: false,
				defaultMode: 'normal',
				createdAt: now,
				lastOpenedAt: now,
				availability: 'available',
			};
			technicalProjects.set(root, project);
		}
		activeProjectId = project.id;
		const wasReady = supervisor.getState(project.id).status === 'ready';
		const state = await supervisor.probeProject(project);
		if (state.status === 'untrusted')
			return {
				status: 'untrusted',
				message: state.reason ?? 'Trust this project before opening it',
			};
		if (state.status !== 'ready') {
			throw new IpcFailure(
				state.status === 'unsupported' ? 'UNSUPPORTED' : 'AGENT_UNAVAILABLE',
				state.reason ?? 'Nanocoder could not start',
			);
		}
		const connection = supervisor.getConnection(project.id);
		session = await prepareSession(
			supervisor,
			project,
			technicalSessions,
			wasReady,
		);
		return {status: 'connected', agent: connection.agent, session};
	} catch (error) {
		if (error instanceof NanocoderFailure)
			throw new IpcFailure(error.code, error.message);
		throw error;
	} finally {
		connecting = false;
	}
}

async function sendPrompt({text}: {text: string}): Promise<TurnResult> {
	if (!supervisor || !activeProjectId || !session) {
		throw new IpcFailure('AGENT_UNAVAILABLE', 'No project is open');
	}
	return supervisor
		.prompt(activeProjectId, session.id, text)
		.catch((error: unknown) => {
			if (error instanceof NanocoderFailure) {
				throw new IpcFailure(error.code, error.message);
			}
			throw error;
		});
}

function answerPermission({
	id,
	optionId,
}: {
	id: string;
	optionId: string;
}): null {
	if (
		!supervisor ||
		!activeProjectId ||
		!session ||
		!supervisor.answerPermission(activeProjectId, session.id, id, optionId)
	) {
		throw new IpcFailure(
			'NOT_FOUND',
			'That permission request is no longer waiting',
		);
	}
	return null;
}

export function closeNanocoder(): Promise<void> {
	runtimeDiscovery.abort();
	return disposeDesktop({
		unsubscribe: unsubscribeProjectEvents,
		cancelPermissions: () => {},
		supervisor: workspaceServices.supervisor,
		store: workspaceServices.store,
	});
}

function watchRenderer(contents: WebContents): void {
	let attached = false;
	const detach = () => {
		if (!attached || !supervisor) return;
		activeProjectId = undefined;
		session = undefined;
		rendererCleanup = Promise.allSettled([
			rendererCleanup,
			stopDetachedTurns(supervisor, technicalProjects.values()),
		]).then(() => {});
	};
	contents.on('did-finish-load', () => {
		attached = isAllowedOrigin(contents.getURL(), appOrigins);
	});
	contents.on(
		'did-start-navigation',
		(_event, _url, isInPlace, isMainFrame) => {
			if (isMainFrame && !isInPlace) detach();
		},
	);
	contents.on('render-process-gone', detach);
	contents.once('destroyed', detach);
}

export function registerIpcHandlers(
	allowedOrigins: readonly string[],
	services: WorkspaceServices = {},
): void {
	appOrigins = allowedOrigins;
	supervisor = services.supervisor
		? undefined
		: new ProjectSupervisor({
				resolveRuntime: (root, signal) =>
					resolveNanocoder({
						env: process.env,
						platform: process.platform,
						untrustedRoots: [root],
						signal,
					}),
				clientInfo: {
					name: 'nanocoder-desktop',
					title: APP_NAME,
					version: app.getVersion(),
				},
				homeDir: homedir(),
				confirmTrust,
			});
	workspaceServices = {
		...services,
		supervisor: services.supervisor ?? supervisor,
	};
	app.on('web-contents-created', (_event, contents) => watchRenderer(contents));
	for (const window of BrowserWindow.getAllWindows())
		watchRenderer(window.webContents);
	registerWorkspaceHandlers(registerHandler, allowedOrigins, workspaceServices);
	unsubscribeProjectEvents = workspaceServices.supervisor?.subscribe(event => {
		if (
			event.type === 'turn' &&
			event.projectId === activeProjectId &&
			event.threadId === session?.id
		) {
			for (const turn of event.events) sendEvent(turn);
		}
		for (const window of BrowserWindow.getAllWindows()) {
			if (
				!window.webContents.isDestroyed() &&
				isAllowedOrigin(window.webContents.getURL(), appOrigins)
			) {
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
