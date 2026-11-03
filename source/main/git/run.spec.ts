import path from 'node:path';
import test from 'ava';
import {gitEnvironment, READ_ONLY_COMMANDS, runGit} from '@/main/git/run';

const run = {
	git: '/usr/bin/git',
	cwd: process.cwd(),
	timeoutMs: 5_000,
	maxBytes: 1_024,
};

test('GIT-14 only read-only subcommands exist, and each other one is refused before any process starts', async t => {
	t.deepEqual([...READ_ONLY_COMMANDS].sort(), [
		'diff',
		'log',
		'rev-parse',
		'status',
	]);
	for (const command of [
		'add',
		'commit',
		'checkout',
		'switch',
		'reset',
		'restore',
		'clean',
		'stash',
		'merge',
		'rebase',
		'push',
		'pull',
		'fetch',
		'config',
		'branch',
		'worktree',
		'rm',
		'mv',
		'apply',
		'cherry-pick',
		'tag',
		'init',
		'clone',
		'-c',
		'--exec-path',
		'',
	])
		await t.throwsAsync(
			runGit({...run, git: '/nonexistent/git'}, [command]),
			{
				code: 'DENIED',
			},
			command,
		);
});

test('SEC-06 GIT-11 a diff must switch off external diff and text conversion', async t => {
	for (const args of [
		['diff', '--', 'a'],
		['diff', '--no-ext-diff', '--', 'a'],
		['diff', '--no-textconv', '--', 'a'],
	])
		await t.throwsAsync(runGit({...run, git: '/nonexistent/git'}, args), {
			code: 'DENIED',
		});
});

test('SEC-06 inherited Git variables never reach Git, and the program path is the only PATH entry', t => {
	const env = gitEnvironment(
		'/opt/git/bin/git',
		{
			HOME: '/home/u',
			PATH: '/project/evil',
			GIT_EXTERNAL_DIFF: '/project/evil',
			GIT_SSH_COMMAND: 'evil',
			GIT_DIR: '/elsewhere',
			GIT_CONFIG_GLOBAL: '/project/gitconfig',
			XDG_CONFIG_HOME: '/home/u/.config',
			NODE_OPTIONS: '--require x',
		},
		'linux',
	);
	t.is(env.PATH, '/opt/git/bin');
	t.is(env.HOME, '/home/u');
	t.is(env.XDG_CONFIG_HOME, '/home/u/.config');
	t.is(env.GIT_PAGER, 'cat');
	t.is(env.GIT_OPTIONAL_LOCKS, '0');
	t.is(env.GIT_TERMINAL_PROMPT, '0');
	t.is(env.GIT_LITERAL_PATHSPECS, '1');
	for (const name of [
		'GIT_EXTERNAL_DIFF',
		'GIT_SSH_COMMAND',
		'GIT_DIR',
		'GIT_CONFIG_GLOBAL',
		'NODE_OPTIONS',
	])
		t.false(name in env, name);
	const windows = gitEnvironment(
		path.win32.join('C:\\Git\\cmd', 'git.exe'),
		{USERPROFILE: 'C:\\Users\\u', SystemRoot: 'C:\\Windows', HOME: 'x'},
		'win32',
	);
	t.is(windows.USERPROFILE, 'C:\\Users\\u');
	t.false('HOME' in windows);
});
