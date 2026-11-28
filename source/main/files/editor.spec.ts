import path from 'node:path';
import test from 'ava';
import {
	EditorLauncher,
	editorArguments,
	editorCandidates,
	runsAsProgram,
} from '@/main/files/editor';
import type {DesktopSettings} from '@/shared/ipc';

function fixture(
	editor: DesktopSettings['editor'],
	found: Record<string, string> = {},
	roots: string[] = [],
	modes: Record<string, number> = {},
	platform: NodeJS.Platform = 'linux',
) {
	const launched: Array<{file: string; args: string[]}> = [];
	const opened: string[] = [];
	const revealed: string[] = [];
	let systemFailure = '';
	let launchFailure = false;
	const launcher = new EditorLauncher({
		editor: () => editor,
		roots: () => roots,
		platform,
		env: {},
		home: '/home/user',
		openPath: async file => {
			opened.push(file);
			return systemFailure;
		},
		showItemInFolder: file => revealed.push(file),
		executable: async candidate => found[candidate],
		mode: async file => modes[file] ?? 0o644,
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

test('FILE-06 SEC-05 the system editor never opens a file that would run as a program', async t => {
	const cases: Array<[NodeJS.Platform, string]> = [
		['darwin', '/work/app/setup.command'],
		['darwin', '/work/app/Run.TOOL'],
		['darwin', '/work/app/link.webloc'],
		['darwin', '/work/app/script.scpt'],
		['win32', 'C:\\work\\app\\setup.bat'],
		['win32', 'C:\\work\\app\\setup.cmd'],
		['win32', 'C:\\work\\app\\tool.EXE'],
		['win32', 'C:\\work\\app\\index.js'],
		['win32', 'C:\\work\\app\\run.vbs'],
		['win32', 'C:\\work\\app\\app.lnk'],
		['win32', 'C:\\work\\app\\page.hta'],
		['win32', 'C:\\work\\app\\build.ps1'],
		['linux', '/work/app/app.desktop'],
		['linux', '/work/app/tool.AppImage'],
	];
	for (const [platform, file] of cases) {
		const f = fixture('system', {}, [], {}, platform);
		await t.throwsAsync(
			f.launcher.open(file),
			{code: 'UNAVAILABLE', message: /could run as a program/},
			`${platform} ${file}`,
		);
		t.deepEqual(f.opened, [], `${platform} ${file}`);
	}
});

test('FILE-06 SEC-05 the system editor refuses a file marked executable outside Windows', async t => {
	for (const platform of ['linux', 'darwin'] as const) {
		const f = fixture(
			'system',
			{},
			[],
			{'/work/app/build': 0o755, '/work/app/notes.txt': 0o744},
			platform,
		);
		await t.throwsAsync(f.launcher.open('/work/app/build'), {
			code: 'UNAVAILABLE',
		});
		await t.throwsAsync(f.launcher.open('/work/app/notes.txt'), {
			code: 'UNAVAILABLE',
		});
		t.deepEqual(f.opened, []);
	}
	t.true(runsAsProgram('C:\\work\\a.ts', 'win32', 0o755) === false);
});

test('FILE-06 ordinary source files still open with the system default', async t => {
	for (const [platform, file] of [
		['darwin', '/work/app/a.ts'],
		['darwin', '/work/app/README.md'],
		['linux', '/work/app/install.sh'],
		['win32', 'C:\\work\\app\\a.ts'],
		['win32', 'C:\\work\\app\\package.json'],
		['win32', 'C:\\work\\app\\Makefile'],
	] as const) {
		const f = fixture('system', {}, [], {}, platform);
		t.deepEqual(await f.launcher.open(file), {editor: 'system'});
		t.deepEqual(f.opened, [file]);
	}
});

test('FILE-06 a named editor still opens a script, since it never runs it', async t => {
	const f = fixture('code', {'/usr/bin/code': '/usr/bin/code'}, [], {
		'/work/app/build': 0o755,
	});
	await f.launcher.open('/work/app/build');
	t.deepEqual(f.launched, [{file: '/usr/bin/code', args: ['/work/app/build']}]);
});

test('FILE-06 a file whose mode cannot be read is not handed to the system', async t => {
	const launcher = new EditorLauncher({
		editor: () => 'system',
		roots: () => [],
		openPath: async () => {
			t.fail('opened');
			return '';
		},
		showItemInFolder: () => undefined,
		platform: 'linux',
		mode: async () => undefined,
	});
	await t.throwsAsync(launcher.open('/work/app/a.ts'), {code: 'UNAVAILABLE'});
});
