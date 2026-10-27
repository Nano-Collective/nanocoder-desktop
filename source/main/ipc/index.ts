import {realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {app, BrowserWindow, dialog, type OpenDialogOptions} from 'electron';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {registerHandler} from '@/main/ipc/register';
import {
	ConnectFailure,
	connectNanocoder,
	type NanocoderConnection,
} from '@/main/nanocoder/acp-client';
import {type Resolution, resolveNanocoder} from '@/main/nanocoder/runtime';
import {APP_NAME} from '@/shared/app-info';
import {
	type AppInfo,
	CHANNELS,
	type ConnectedAgent,
	type NanocoderRuntime,
} from '@/shared/ipc';

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

async function connect(): Promise<ConnectedAgent | null> {
	if (connecting) {
		throw new IpcFailure('BUSY', 'Already connecting to Nanocoder', true);
	}
	connecting = true;
	try {
		const root = await chooseProjectRoot();
		if (!root) return null;
		const resolved = await nanocoderRuntime();
		await connection?.close();
		connection = undefined;
		const next = await connectNanocoder({
			runtime: resolved,
			root,
			clientInfo: {
				name: 'nanocoder-desktop',
				title: APP_NAME,
				version: app.getVersion(),
			},
			homeDir: homedir(),
		}).catch((error: unknown) => {
			if (error instanceof ConnectFailure) {
				throw new IpcFailure(
					error.code,
					error.message,
					error.code === 'AGENT_UNAVAILABLE',
				);
			}
			throw error;
		});
		connection = next;
		void next.exited.then(() => {
			if (connection === next) connection = undefined;
		});
		return next.agent;
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
