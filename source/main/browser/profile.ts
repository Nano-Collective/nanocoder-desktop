import type {WebPreferences} from 'electron';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BrowserProfileRef =
	| {kind: 'project'}
	| {kind: 'default'}
	| {kind: 'incognito'}
	| {kind: 'named'; id: string};

export function profileKey(profile: BrowserProfileRef): string {
	return profile.kind === 'named' ? profile.id.toLowerCase() : profile.kind;
}

export function parseProfileKey(value: string): BrowserProfileRef | null {
	if (value === 'project' || value === 'default' || value === 'incognito')
		return {kind: value};
	return UUID.test(value) ? {kind: 'named', id: value.toLowerCase()} : null;
}

export function browserPartition(
	projectId: string | null,
	profile: BrowserProfileRef = {kind: 'project'},
): string {
	if (profile.kind === 'default') return 'persist:browser-default';
	if (profile.kind === 'named') {
		if (!UUID.test(profile.id))
			throw new TypeError('A named browser profile needs its id');
		return `persist:browser-profile-${profile.id.toLowerCase()}`;
	}
	if (projectId === null || !UUID.test(projectId))
		throw new TypeError('A browser profile needs a project id');
	const project = projectId.toLowerCase();
	return profile.kind === 'incognito'
		? `browser-incognito-${project}`
		: `persist:browser-${project}`;
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
		// Both are needed: removing only FileSystemAccess left the pickers in place.
		disableBlinkFeatures: 'FileSystemAccess,FileSystemAccessLocal',
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
