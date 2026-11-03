import test from 'ava';
import {gitCandidates, locateGit, parseVersion} from '@/main/git/locate';
import type {GitOutput} from '@/main/git/run';

const answer = (text: string, code = 0): GitOutput => ({
	stdout: Buffer.from(text),
	stderr: '',
	code,
});

function fixture(
	found: Record<string, string>,
	versions: Record<string, string>,
	extra: {
		platform?: NodeJS.Platform;
		roots?: string[];
		developerTools?: boolean;
	} = {},
) {
	const ran: string[] = [];
	return {
		ran,
		lookup: () =>
			locateGit({
				roots: () => extra.roots ?? [],
				platform: extra.platform ?? 'linux',
				env: {PATH: '/project/bin:/usr/bin:relative/bin'},
				executable: async candidate => found[candidate],
				developerTools: async () => extra.developerTools ?? true,
				run: async (call, args) => {
					ran.push(call.git);
					t_assert(args.join(' ') === '--version');
					return answer(versions[call.git] ?? '', versions[call.git] ? 0 : 1);
				},
			}),
	};
}
const t_assert = (value: boolean) => {
	if (!value) throw new Error('unexpected arguments');
};

test('GIT-01 the version is parsed from Git, Apple and Windows output', t => {
	t.is(parseVersion('git version 2.39.2 (Apple Git-143)\n'), '2.39.2');
	t.is(parseVersion('git version 2.45.1.windows.1'), '2.45.1');
	t.is(parseVersion('nonsense'), undefined);
});

test('GIT-01 candidates are absolute only; a relative PATH entry is never used', t => {
	const list = gitCandidates('linux', {PATH: '/a/bin:rel/bin:/b/bin'});
	t.true(list.includes('/a/bin/git'));
	t.true(list.includes('/usr/bin/git'));
	t.false(list.some(entry => entry.includes('rel')));
	const windows = gitCandidates('win32', {
		ProgramFiles: 'C:\\Program Files',
		PATH: 'C:\\tools;relative',
	});
	t.true(windows.includes('C:\\Program Files\\Git\\cmd\\git.exe'));
	t.true(windows.includes('C:\\tools\\git.exe'));
});

test('GIT-01 the first usable Git is chosen and its path and version are reported', async t => {
	const f = fixture(
		{'/usr/bin/git': '/usr/bin/git'},
		{'/usr/bin/git': 'git version 2.40.0'},
	);
	t.deepEqual(await f.lookup(), {
		ok: true,
		git: {path: '/usr/bin/git', version: '2.40.0'},
	});
});

test('SEC-06 a Git program inside a project folder is never used', async t => {
	const f = fixture(
		{'/project/bin/git': '/project/bin/git', '/usr/bin/git': '/usr/bin/git'},
		{
			'/project/bin/git': 'git version 9.9.9',
			'/usr/bin/git': 'git version 2.40.0',
		},
		{roots: ['/project']},
	);
	const result = await f.lookup();
	t.deepEqual(result, {
		ok: true,
		git: {path: '/usr/bin/git', version: '2.40.0'},
	});
	t.false(f.ran.includes('/project/bin/git'));
});

test('GIT-13 without Git, or with one that is too old, review gives a reason', async t => {
	t.deepEqual(await fixture({}, {}).lookup(), {
		ok: false,
		reason: 'Git is not installed, so review is unavailable',
	});
	t.deepEqual(
		await fixture(
			{'/usr/bin/git': '/usr/bin/git'},
			{'/usr/bin/git': 'git version 2.10.0'},
		).lookup(),
		{
			ok: false,
			reason: 'Git 2.10.0 is too old; version 2.15 or newer is needed',
		},
	);
	const broken = await fixture({'/usr/bin/git': '/usr/bin/git'}, {}).lookup();
	t.false(broken.ok);
});

test('GIT-01 the macOS stub that only prompts for developer tools is explained, not run', async t => {
	const f = fixture(
		{'/usr/bin/git': '/usr/bin/git'},
		{'/usr/bin/git': 'git version 2.39.2'},
		{platform: 'darwin', developerTools: false},
	);
	const result = await f.lookup();
	t.false(result.ok);
	if (!result.ok) t.regex(result.reason, /developer tools/);
	t.deepEqual(f.ran, []);
});

test("GIT-01 the real lookup finds this machine's Git by an absolute path outside any project", async t => {
	const {runGit} = await import('@/main/git/run');
	const result = await locateGit({roots: () => [], run: runGit});
	t.true(result.ok, result.ok ? '' : result.reason);
	if (result.ok) {
		t.regex(result.git.version, /^\d+\.\d+/);
		const path = await import('node:path');
		t.true(path.isAbsolute(result.git.path));
	}
});
