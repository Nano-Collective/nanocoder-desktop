import type {WebPreferences} from 'electron';

const PROJECT_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function browserPartition(projectId: string): string {
	if (!PROJECT_ID.test(projectId))
		throw new TypeError('A browser profile needs a project id');
	return `persist:browser-${projectId.toLowerCase()}`;
}

export function browserWebPreferences(
	partition: string,
): WebPreferences & {partition: string} {
	return {
		partition,
		sandbox: true,
		contextIsolation: true,
		nodeIntegration: false,
		nodeIntegrationInSubFrames: false,
		nodeIntegrationInWorker: false,
		webSecurity: true,
		webviewTag: false,
		allowRunningInsecureContent: false,
	};
}

export interface PermissionTarget {
	setPermissionRequestHandler(
		handler: (
			contents: unknown,
			permission: string,
			done: (allowed: boolean) => void,
		) => void,
	): void;
	setPermissionCheckHandler(handler: () => boolean): void;
	setDevicePermissionHandler(handler: () => boolean): void;
}

export function denyBrowserPermissions(target: PermissionTarget): void {
	target.setPermissionRequestHandler((_contents, _permission, done) =>
		done(false),
	);
	target.setPermissionCheckHandler(() => false);
	target.setDevicePermissionHandler(() => false);
}
