import {app} from 'electron';
import {z} from 'zod';
import {registerHandler} from '@/main/ipc/register';
import {APP_NAME} from '@/shared/app-info';
import {type AppInfo, CHANNELS} from '@/shared/ipc';

export function registerIpcHandlers(allowedOrigins: readonly string[]): void {
	registerHandler(
		CHANNELS.getAppInfo,
		z.strictObject({}),
		(): AppInfo => ({name: APP_NAME, version: app.getVersion()}),
		allowedOrigins,
	);
}
