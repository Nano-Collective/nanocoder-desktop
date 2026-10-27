import {app} from 'electron';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {registerHandler} from '@/main/ipc/register';
import {type Resolution, resolveNanocoder} from '@/main/nanocoder/runtime';
import {APP_NAME} from '@/shared/app-info';
import {type AppInfo, CHANNELS, type NanocoderRuntime} from '@/shared/ipc';

let runtime: Promise<Resolution> | undefined;

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
}
