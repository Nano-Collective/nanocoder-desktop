import path from 'node:path';
import test from 'ava';
import {
	EditorLauncher,
	editorArguments,
	editorCandidates,
} from '@/main/files/editor';
import type {DesktopSettings} from '@/shared/ipc';

function fixture(
	editor: DesktopSettings['editor'],
	found: Record<string, string> = {},
	roots: string[] = [],
) {
	const launched: Array<{file: string; args: string[]}> = [];
	const opened: string[] = [];
	const revealed: string[] = [];
	let systemFailure = '';
	let launchFailure = false;
	const launcher = new EditorLauncher({
		editor: () => editor,
		roots: () => roots,
		platform: 'linux',
		env: {},
		home: '/home/user',
		openPath: async file => {
			opened.push(file);
			return systemFailure;
		},
		showItemInFolder: file => revealed.push(file),
		executable: async candidate => found[candidate],
		launch: async (file, args) => {
			if (launchFailure) throw new Error('spawn failed');
			launched.push({file, args});
		},
	});
	return {
		launcher,
		launched,
		opened,
		revealed,
		failSystem: (message: string) => {
			systemFailure = message;
		},
		failLaunch: () => {
			launchFailure = true;
		},
	};
}

test('FILE-06 the system editor goes through the operating system, not a program lookup', async t => {
	const f = fixture('system');
	t.deepEqual(await f.launcher.open('/work/app/a.ts'), {editor: 'system'});
	t.deepEqual(f.opened, ['/work/app/a.ts']);
	t.deepEqual(f.launched, []);
	f.failSystem('No application is associated');
	await t.throwsAsync(f.launcher.open('/work/app/a.ts'), {code: 'UNAVAILABLE'});
});

test('FILE-06 SEC-05 a chosen editor starts from a known absolute path with an argument array', async t => {
	const f = fixture('code', {'/usr/bin/code': '/usr/bin/code'});
	await f.launcher.open('/work/app/a.ts', 12);
	t.deepEqual(f.launched, [
		{file: '/usr/bin/code', args: ['--goto', '/work/app/a.ts:12']},
	]);
	await f.launcher.open('/work/app/b.ts');
	t.deepEqual(f.launched[1].args, ['/work/app/b.ts']);
	t.deepEqual(editorArguments('zed', '/w/a.ts', 3), ['/w/a.ts:3']);
	t.deepEqual(editorArguments('cursor', '/w/a.ts', 3), ['--goto', '/w/a.ts:3']);
});

test('SEC-05 an editor program inside a project folder is never launched', async t => {
	const f = fixture(
		'code',
		{
			'/usr/bin/code': '/work/app/tools/code',
			'/usr/local/bin/code': '/usr/local/bin/code',
		},
		['/work/app'],
	);
	await f.launcher.open('/work/app/a.ts');
	t.is(f.launched[0].file, '/usr/local/bin/code');
	const only = fixture('code', {'/usr/bin/code': '/work/app/tools/code'}, [
		'/work/app',
	]);
	await t.throwsAsync(only.launcher.open('/work/app/a.ts'), {
		code: 'UNAVAILABLE',
		message:
			'Visual Studio Code was not found. Choose another editor in settings.',
	});
	t.deepEqual(only.launched, []);
});

test('FILE-06 a missing editor and a failed start give a plain message', async t => {
	const none = fixture('zed');
	await t.throwsAsync(none.launcher.open('/work/app/a.ts'), {
		message: 'Zed was not found. Choose another editor in settings.',
	});
	const broken = fixture('cursor', {'/usr/bin/cursor': '/usr/bin/cursor'});
	broken.failLaunch();
	await t.throwsAsync(broken.launcher.open('/work/app/a.ts'), {
		message: 'Cursor could not be started',
	});
});

test('FILE-07 reveal hands the resolved path to the file manager', t => {
	const f = fixture('system');
	f.launcher.reveal('/work/app/a.ts');
	t.deepEqual(f.revealed, ['/work/app/a.ts']);
});

test('SEC-05 candidate lists are absolute on every platform and never a bare name', t => {
	for (const platform of ['linux', 'darwin', 'win32'] as const)
		for (const editor of ['code', 'cursor', 'zed'] as const) {
			const list = editorCandidates(
				editor,
				platform,
				{LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local'},
				platform === 'win32' ? 'C:\\Users\\u' : '/home/u',
			);
			t.true(list.length > 0);
			const flavour = platform === 'win32' ? path.win32 : path.posix;
			for (const candidate of list)
				t.true(flavour.isAbsolute(candidate), candidate);
		}
	t.true(
		editorCandidates('code', 'win32', {}, 'C:\\Users\\u')[0].endsWith(
			'Code.exe',
		),
	);
});

test('FILE-06 a real program that cannot start gives a plain message and nothing stays running', async t => {
	const launcher = new EditorLauncher({
		editor: () => 'zed',
		roots: () => [],
		openPath: async () => '',
		showItemInFolder: () => undefined,
		platform: 'linux',
		home: '/home/u',
		executable: async () => '/nonexistent/folder/zed',
	});
	await t.throwsAsync(launcher.open('/work/app/a.ts', 3), {
		message: 'Zed could not be started',
	});
});

test('FILE-06 a real program that starts is detached from the app', async t => {
	const launcher = new EditorLauncher({
		editor: () => 'code',
		roots: () => [],
		openPath: async () => '',
		showItemInFolder: () => undefined,
		platform: 'linux',
		home: '/home/u',
		// Node ignores the editor-style arguments and exits straight away.
		executable: async () => process.execPath,
	});
	t.deepEqual(await launcher.open('/work/app/a.ts'), {editor: 'code'});
});

test('FILE-06 without any known install the default lookup finds no editor', async t => {
	const launcher = new EditorLauncher({
		editor: () => 'cursor',
		roots: () => [],
		openPath: async () => '',
		showItemInFolder: () => undefined,
		platform: 'win32',
		env: {LOCALAPPDATA: 'C:\\no\\such\\folder'},
	});
	await t.throwsAsync(launcher.open('C:\\work\\a.ts'), {
		message: 'Cursor was not found. Choose another editor in settings.',
	});
});
