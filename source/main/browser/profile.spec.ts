import test from 'ava';
import {
	browserPartition,
	browserWebPreferences,
	denyBrowserPermissions,
} from '@/main/browser/profile';

const first = '4f6c1f0e-3a55-4a0b-9d1e-0a2b3c4d5e6f';
const second = '9b1d2c3e-4f50-4a6b-8c7d-1e2f3a4b5c6d';

test('BRW-01/DEC-49 each project gets its own persistent partition', t => {
	const a = browserPartition(first);
	const b = browserPartition(second);
	t.true(a.startsWith('persist:'));
	t.not(a, b);
	t.is(a, browserPartition(first));
});

test('BRW-05 the partition never reuses the app session or a path-like name', t => {
	const name = browserPartition(first);
	t.notRegex(name, /[\\/.]/);
	t.not(name, 'persist:');
});

test('BRW-01 a partition is refused for anything that is not a project id', t => {
	for (const value of [
		'',
		'..',
		'../escape',
		'default',
		`${first}/x`,
		`${first}\n`,
		'incognito',
	])
		t.throws(() => browserPartition(value), undefined, JSON.stringify(value));
});

test('SEC-12 the view is sandboxed with no Node, no preload and no IPC bridge', t => {
	const preferences = browserWebPreferences(browserPartition(first));
	t.true(preferences.sandbox);
	t.true(preferences.contextIsolation);
	t.false(preferences.nodeIntegration);
	t.false(preferences.nodeIntegrationInSubFrames);
	t.false(preferences.nodeIntegrationInWorker);
	t.true(preferences.webSecurity);
	t.false(preferences.webviewTag);
	t.false(preferences.allowRunningInsecureContent);
	t.false('preload' in preferences);
	t.is(
		preferences.disableBlinkFeatures,
		'FileSystemAccess,FileSystemAccessLocal',
	);
	t.is(preferences.partition, browserPartition(first));
});

test('SEC-10 the partition denies every permission request and check', t => {
	let request:
		| ((
				contents: unknown,
				permission: string,
				done: (allowed: boolean) => void,
		  ) => void)
		| undefined;
	let check: (() => boolean) | undefined;
	let device: (() => boolean) | undefined;
	denyBrowserPermissions({
		setPermissionRequestHandler: handler => {
			request = handler;
		},
		setPermissionCheckHandler: handler => {
			check = handler;
		},
		setDevicePermissionHandler: handler => {
			device = handler;
		},
	});
	const answers: boolean[] = [];
	for (const permission of [
		'media',
		'geolocation',
		'notifications',
		'clipboard-read',
		'openExternal',
	])
		request?.({}, permission, allowed => answers.push(allowed));
	t.deepEqual(answers, [false, false, false, false, false]);
	t.false(check?.());
	t.false(device?.());
});
