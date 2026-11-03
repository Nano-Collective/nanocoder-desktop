import test from 'ava';
import type {GitService} from '@/main/git/git-service';
import {ReviewService} from '@/main/git/review-service';
import {TurnTracker} from '@/main/git/turn-tracker';
import type {ProjectEvent, TurnEvent} from '@/shared/ipc';

function fixture() {
	const heads: Array<string | null> = [];
	const changed: string[] = [];
	const asked: Array<[string | null, string | null]> = [];
	let failHead = false;
	const tracker = new TurnTracker({
		head: async () => {
			if (failHead) throw new Error('git failed');
			return heads.shift() ?? null;
		},
		commits: async (_project, before, after) => {
			asked.push([before, after]);
			return after && after !== before
				? [{hash: after, subject: 'agent commit'}]
				: [];
		},
		relative: (_project, reported) => {
			const prefix = '/work/app/';
			const path = reported.startsWith(prefix)
				? reported.slice(prefix.length)
				: reported;
			return path.startsWith('..') || path.startsWith('/') ? undefined : path;
		},
		changed: projectId => changed.push(projectId),
	});
	const turn = (
		events: TurnEvent[],
		threadId = 'thread',
		replay = false,
	): ProjectEvent => ({
		type: 'turn',
		projectId: 'p',
		threadId,
		sequence: 1,
		events,
		...(replay ? {replay: {epoch: 'e', phase: 'begin' as const}} : {}),
	});
	const tool = (
		toolKind: string | undefined,
		...paths: string[]
	): TurnEvent => ({
		type: 'tool',
		id: 'call',
		toolKind,
		details: {locations: paths.map(path => ({path}))},
	});
	return {
		tracker,
		heads,
		changed,
		asked,
		turn,
		tool,
		failHead: () => {
			failHead = true;
		},
	};
}

test('GIT-05 only tool calls that change files label them as touched, once each', async t => {
	const f = fixture();
	f.heads.push('before');
	await f.tracker.begin('p', 'thread');
	f.tracker.observe(
		f.turn([
			f.tool('edit', '/work/app/src/a.ts'),
			f.tool('read', '/work/app/src/read-only.ts'),
			f.tool('search', '/work/app/src/searched.ts'),
			f.tool(undefined, '/work/app/src/unknown.ts'),
			f.tool('delete', 'src/gone.ts'),
			f.tool('move', '/work/app/src/a.ts', '/work/app/src/b.ts'),
			f.tool('edit', '/elsewhere/outside.ts', '../escape.ts'),
		]),
	);
	t.deepEqual(f.tracker.latest('p')?.touched, [
		'src/a.ts',
		'src/gone.ts',
		'src/b.ts',
	]);
	t.true(f.tracker.latest('p')?.running);
});

test('GIT-05 events from another thread, replays and unrelated events are ignored', async t => {
	const f = fixture();
	await f.tracker.begin('p', 'thread');
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/a.ts')], 'other'));
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/a.ts')], 'thread', true));
	f.tracker.observe({type: 'project-removed', projectId: 'p', sequence: 1});
	f.tracker.observe({
		...f.turn([f.tool('edit', '/work/app/a.ts')]),
		projectId: 'unknown',
	});
	t.deepEqual(f.tracker.latest('p')?.touched, []);
});

test('GIT-12 HEAD is recorded before and after, and commits made meanwhile are listed', async t => {
	const f = fixture();
	f.heads.push('before', 'after');
	await f.tracker.begin('p', 'thread');
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/a.ts')]));
	await f.tracker.end('p', 'thread', true);
	const turn = f.tracker.latest('p');
	t.false(turn?.running);
	t.is(turn?.headBefore, 'before');
	t.is(turn?.headAfter, 'after');
	t.deepEqual(turn?.commits, [{hash: 'after', subject: 'agent commit'}]);
	t.deepEqual(f.asked, [['before', 'after']]);
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/late.ts')]));
	t.deepEqual(f.tracker.latest('p')?.touched, ['a.ts']);
});

test('GIT-12 an unchanged HEAD lists no commits, and a turn for another thread cannot end this one', async t => {
	const f = fixture();
	f.heads.push('same', 'same');
	await f.tracker.begin('p', 'thread');
	await f.tracker.end('p', 'other', true);
	t.true(f.tracker.latest('p')?.running);
	await f.tracker.end('p', 'thread', true);
	t.deepEqual(f.tracker.latest('p')?.commits, []);
	await f.tracker.end('unknown', 'thread', true);
});

test('GIT-05 Git failing never breaks the turn, and the latest turn replaces the last one', async t => {
	const f = fixture();
	f.failHead();
	await f.tracker.begin('p', 'one');
	t.is(f.tracker.latest('p')?.headBefore, null);
	await f.tracker.end('p', 'one', true);
	t.is(f.tracker.latest('p')?.headAfter, null);
	await f.tracker.begin('p', 'two');
	t.is(f.tracker.latest('p')?.threadId, 'two');
	f.tracker.forget('p');
	t.is(f.tracker.latest('p'), null);
	t.true(f.changed.length >= 3);
});

test('GIT-05 the latest turn is a copy, so callers cannot change it', async t => {
	const f = fixture();
	await f.tracker.begin('p', 'thread');
	const copy = f.tracker.latest('p');
	copy?.touched.push('hacked');
	t.deepEqual(f.tracker.latest('p')?.touched, []);
});

test('GIT-05 the review joins Git status with the touched labels', async t => {
	const f = fixture();
	await f.tracker.begin('p', 'thread');
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/a.ts')]));
	const git = {
		status: async (projectId: string) =>
			projectId === 'p'
				? {
						available: true as const,
						git: {path: '/usr/bin/git', version: '2.40.0'},
						head: 'h',
						branch: 'main',
						ignored: [],
						notShown: 0,
						entries: [
							{
								path: 'a.ts',
								oldPath: null,
								staged: 'none' as const,
								unstaged: 'modified' as const,
								untracked: false,
								conflicted: false,
							},
							{
								path: 'b.ts',
								oldPath: null,
								staged: 'none' as const,
								unstaged: 'modified' as const,
								untracked: false,
								conflicted: false,
							},
						],
					}
				: {available: false as const, reason: 'No Git'},
		diff: async (_project: string, path: string, staged: boolean) => ({
			path,
			staged,
			kind: 'none' as const,
			reason: 'nothing',
		}),
	} as unknown as GitService;
	const review = new ReviewService(git, f.tracker);
	const status = await review.status({projectId: 'p'});
	if (!status.available) throw new Error('unexpected');
	t.deepEqual(
		status.entries.map(entry => [entry.path, entry.touched]),
		[
			['a.ts', true],
			['b.ts', false],
		],
	);
	t.is(status.turn?.threadId, 'thread');
	t.deepEqual(await review.status({projectId: 'x'}), {
		available: false,
		reason: 'No Git',
	});
	t.is(
		(await review.diff({projectId: 'p', path: 'a.ts', staged: true})).kind,
		'none',
	);
});

test('GIT-05 a second prompt while a turn runs leaves that turn untouched', async t => {
	const f = fixture();
	t.true(await f.tracker.begin('p', 'thread'));
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/a.ts')]));
	t.false(await f.tracker.begin('p', 'thread'));
	t.false(await f.tracker.begin('p', 'other'));
	t.deepEqual(f.tracker.latest('p')?.touched, ['a.ts']);
	await f.tracker.end('p', 'other', false);
	t.true(f.tracker.latest('p')?.running);
});

test('GIT-05 a prompt refused before any event keeps the earlier turn labels', async t => {
	const f = fixture();
	await f.tracker.begin('p', 'one');
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/kept.ts')], 'one'));
	await f.tracker.end('p', 'one', true);
	await f.tracker.begin('p', 'two');
	await f.tracker.end('p', 'two', false);
	t.is(f.tracker.latest('p')?.threadId, 'one');
	t.deepEqual(f.tracker.latest('p')?.touched, ['kept.ts']);
	await f.tracker.begin('p', 'three');
	f.tracker.observe(f.turn([f.tool('edit', '/work/app/partial.ts')], 'three'));
	await f.tracker.end('p', 'three', false);
	t.is(f.tracker.latest('p')?.threadId, 'three');
	t.false(f.tracker.latest('p')?.running);
	const fresh = fixture();
	await fresh.tracker.begin('p', 'only');
	await fresh.tracker.end('p', 'only', false);
	t.is(fresh.tracker.latest('p'), null);
});

test('GIT-05 a turn is registered before HEAD is read, so early edits and a cancel are never missed', async t => {
	let release!: (value: string) => void;
	const slow = new Promise<string>(resolve => {
		release = resolve;
	});
	const tracker = new TurnTracker({
		head: () => slow,
		commits: async () => [],
		relative: (_project, reported) => reported,
		changed: () => undefined,
	});
	const begun = tracker.begin('p', 'thread');
	// Registered synchronously: nothing has waited for Git yet.
	t.true(tracker.latest('p')?.running);
	t.is(tracker.latest('p')?.headBefore, null);
	tracker.observe({
		type: 'turn',
		projectId: 'p',
		threadId: 'thread',
		sequence: 1,
		events: [
			{
				type: 'tool',
				id: 'call',
				toolKind: 'edit',
				details: {locations: [{path: 'early.ts'}]},
			},
		],
	});
	t.deepEqual(tracker.latest('p')?.touched, ['early.ts']);
	t.false(await Promise.race([begun.then(() => true), Promise.resolve(false)]));
	release('abc');
	t.true(await begun);
	t.is(tracker.latest('p')?.headBefore, 'abc');
});
