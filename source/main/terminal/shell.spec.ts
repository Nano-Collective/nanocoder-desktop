import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {discoverShell, terminalEnvironment} from '@/main/terminal/shell';

test('TERM-03/10 account shell takes precedence and starts as a login shell', async t => {
	const checked: string[] = [];
	const shell = await discoverShell({
		roots: ['/project'],
		platform: 'darwin',
		accountShell: '/bin/zsh',
		env: {SHELL: '/bin/bash', PATH: '/project/bin'},
		validate: async file => {
			checked.push(file);
			return file;
		},
	});
	t.deepEqual(shell, {file: '/bin/zsh', args: ['-l']});
	t.deepEqual(checked, ['/bin/zsh']);
});

test('SEC-05 relative, project-owned and symlinked shells are refused, never PATH-resolved', async t => {
	const checked: string[] = [];
	const shell = await discoverShell({
		roots: ['/project'],
		platform: 'linux',
		accountShell: 'bash',
		env: {SHELL: '/outside/shell', PATH: '/project/bin'},
		validate: async file => {
			checked.push(file);
			if (file === '/outside/shell') return '/project/bin/bash';
			return file;
		},
	});
	t.deepEqual(shell, {file: '/bin/bash', args: ['-l']});
	t.deepEqual(checked, ['/outside/shell', '/bin/bash']);
	await t.throwsAsync(
		discoverShell({
			roots: ['/'],
			platform: 'linux',
			accountShell: '/project/bash',
			env: {},
			validate: async file => file,
		}),
		{code: 'UNAVAILABLE'},
	);
});

test('TERM-03 Windows only launches absolute known shells with fixed arguments', async t => {
	t.deepEqual(
		await discoverShell({
			roots: ['C:\\project'],
			platform: 'win32',
			env: {ComSpec: 'C:\\Windows\\System32\\cmd.exe'},
			validate: async file => file,
		}),
		{file: 'C:\\Windows\\System32\\cmd.exe', args: ['/D', '/Q']},
	);
	const shell = await discoverShell({
		roots: ['C:\\project'],
		platform: 'win32',
		env: {ComSpec: 'C:\\project\\cmd.exe'},
		validate: async file => file,
	});
	t.is(shell.file, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
});

test('SEC-05 inherited loader and trust variables never reach the terminal', t => {
	t.deepEqual(
		terminalEnvironment({
			PATH: '/usr/bin',
			SHELL: '/bin/sh',
			LANG: 'en_GB.UTF-8',
			NODE_OPTIONS: 'secret',
			NODE_PATH: '/project',
			ELECTRON_RUN_AS_NODE: '1',
			LD_PRELOAD: '/project/inject.so',
			DYLD_INSERT_LIBRARIES: '/project/inject.dylib',
			BASH_ENV: '/project/startup',
			ENV: '/project/startup',
			ZDOTDIR: '/project',
			NANOCODER_TRUST_DIRECTORY: '1',
		}),
		{
			PATH: '/usr/bin',
			SHELL: '/bin/sh',
			LANG: 'en_GB.UTF-8',
			TERM: 'xterm-256color',
		},
	);
});

test('SEC-05 the default validator refuses folders, non-executables and shells under a root', async t => {
	if (process.platform === 'win32') {
		t.pass();
		return;
	}
	const root = await realpath(await mkdtemp(path.join(tmpdir(), 'shell-')));
	t.teardown(() => rm(root, {recursive: true, force: true}));
	const plain = path.join(root, 'plain');
	const owned = path.join(root, 'owned');
	await writeFile(plain, '#!/bin/sh\n', {mode: 0o644});
	await writeFile(owned, '#!/bin/sh\n', {mode: 0o755});
	const shell = await discoverShell({
		roots: [],
		platform: 'linux',
		accountShell: root,
		env: {SHELL: plain},
	});
	t.is(
		shell.file,
		await realpath('/bin/bash').catch(() => realpath('/bin/sh')),
	);
	const outside = await discoverShell({
		roots: [root],
		accountShell: owned,
		env: {SHELL: owned},
	});
	t.false(outside.file.startsWith(root));
	t.true(path.isAbsolute(outside.file));
	const account = await discoverShell({roots: [root], env: {}});
	t.true(path.isAbsolute(account.file));
	t.false(account.file.startsWith(root));
});
