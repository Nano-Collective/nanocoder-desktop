import {execFileSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {GIT_LIMITS, GitService} from '@/main/git/git-service';
import type {ProjectInfo} from '@/shared/ipc';

// Building a 100,000-file repository takes a while, so these run on request:
//   NANOCODER_DESKTOP_PERF=1 pnpm exec ava source/main/git/perf.spec.ts --timeout=15m
const enabled = process.env.NANOCODER_DESKTOP_PERF === '1';
const perf = enabled ? test.serial : test.serial.skip;

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 64 * 1_048_576,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
		},
	});

perf(
	'PERF-07 PERF-08 status on 100,000 tracked files returns within 5 seconds, and a 1 MiB diff within 1 second',
	async t => {
		t.timeout(15 * 60_000);
		const root = realpathSync.native(
			mkdtempSync(path.join(tmpdir(), 'nd-perf-')),
		);
		t.teardown(() => rmSync(root, {recursive: true, force: true}));
		git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
		git(root, 'config', 'core.autocrlf', 'false');
		for (let directory = 0; directory < 1_000; directory++) {
			const folder = path.join(root, `d${directory}`);
			mkdirSync(folder);
			for (let file = 0; file < 100; file++)
				writeFileSync(
					path.join(folder, `f${file}.txt`),
					`${directory}-${file}\n`,
				);
		}
		writeFileSync(path.join(root, 'big.txt'), 'seed\n');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'fixture');
		t.is(git(root, 'ls-files').split('\n').filter(Boolean).length, 100_001);
		for (let file = 0; file < 50; file++)
			writeFileSync(path.join(root, 'd7', `f${file}.txt`), 'changed\n');
		writeFileSync(path.join(root, 'untracked.txt'), 'new\n');
		const project: ProjectInfo = {
			id: 'project',
			canonicalRoot: root,
			sessionCwd: root,
			displayName: 'fixture',
			trusted: true,
			defaultMode: 'normal',
			availability: 'available',
			createdAt: '',
			lastOpenedAt: '',
		};
		const service = new GitService({project: () => project, roots: () => []});
		const started = performance.now();
		const status = await service.status('project');
		const elapsed = performance.now() - started;
		t.log(`status over 100,001 tracked files: ${Math.round(elapsed)} ms`);
		t.true(status.available);
		if (status.available) t.is(status.entries.length, 51);
		t.true(elapsed < GIT_LIMITS.statusMilliseconds, `took ${elapsed} ms`);
		writeFileSync(
			path.join(root, 'big.txt'),
			`${'0123456789abcdef'.repeat(60_000)}\n`,
		);
		service.invalidate('project');
		const diffStarted = performance.now();
		const diff = await service.diff('project', 'big.txt', false);
		const diffElapsed = performance.now() - diffStarted;
		t.log(`diff of about 1 MiB: ${Math.round(diffElapsed)} ms (${diff.kind})`);
		t.is(diff.kind, 'text');
		t.true(diffElapsed < 1_000, `took ${diffElapsed} ms`);
	},
);
