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
import {
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import {openProject} from '@/main/nanocoder/open-project';
import {type Resolution, resolveNanocoder} from '@/main/nanocoder/runtime';
import type {TrustReason, TrustRefusal} from '@/main/nanocoder/trust';
import {APP_NAME} from '@/shared/app-info';
import {
	type AppInfo,
	CHANNELS,
	type ConnectResult,
	type NanocoderMode,
	type NanocoderRuntime,
} from '@/shared/ipc';

const DEFAULT_MODE: NanocoderMode = 'normal';

const TRUST_QUESTIONS: Record<TrustReason, string> = {
	'not-trusted': 'Trust this folder?',
	changed: 'This folder changed since you trusted it. Trust it again?',
	'needs-re-approval': 'Nanocoder was updated. Approve this folder again?',
};

let runtime: Promise<Resolution> | undefined;
let connection: NanocoderConnection | undefined;
let connecting = false;

async function nanocoderRuntime(): Promise<NanocoderRuntime> {
	runtime ??= resolveNanocoder({
		env: process.env,
		platform: process.platform,
		untrustedRoots: [],
	});
	const resolution = await runtime;
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
		title: 'Trust this folder?',
		message: TRUST_QUESTIONS[refusal.reason],
		detail: `Nanocoder: ${refusal.summary}\n\nTrusting it lets Nanocoder load this folder's own configuration, hooks, MCP servers and plugins, which can run code on this computer.`,
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
		await connection?.close();
		connection = undefined;
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
		void next.exited.then(() => {
			if (connection === next) connection = undefined;
		});
		return {status: 'connected', agent: next.agent, session: outcome.session};
	} finally {
		connecting = false;
	}
}

export function closeNanocoder(): void {
	void connection?.close();
}

export function registerIpcHandlers(allowedOrigins: readonly string[]): void {
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
}
