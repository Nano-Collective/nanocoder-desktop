import test from 'ava';
import {AgentChangesService} from '@/main/git/agent-changes';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {TimelineEntry, TimelineRead} from '@/main/nanocoder/timeline';
import type {ReviewDiff, TurnReview} from '@/shared/review';

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
	id: 'c1',
	seq: 1,
	truncateToMessageIndex: 2,
	filesChanged: ['a.txt'],
	createdFiles: [],
	...over,
});

const textDiff = (path: string): ReviewDiff => ({
	path,
	staged: false,
	kind: 'text',
	diff: '@@ -1 +1 @@\n-x\n+y\n',
	added: 1,
	removed: 1,
});

function setup(
	over: {
		turn?: Partial<TurnReview> | null;
		enabled?: boolean;
		entries?: TimelineEntry[] | Error;
		reads?: Record<string, TimelineRead | Error>;
		compared?: ReviewDiff;
		session?: boolean;
	} = {},
) {
	const calls: Array<{before: string | null; path: string}> = [];
	const reads: Array<{checkpointId: string; path: string}> = [];
	const turn: TurnReview | null =
		over.turn === null
			? null
			: {
					threadId: 'thread',
					running: false,
					touched: ['a.txt'],
					headBefore: null,
					headAfter: null,
					commits: [],
					...over.turn,
				};
	const service = new AgentChangesService({
		tracker: {latest: () => turn},
		gate: () =>
			over.enabled === false
				? {enabled: false, reason: 'not offered'}
				: {enabled: true, reason: null},
		snapshots: () =>
			over.session === false
				? undefined
				: {
						list: async () => {
							const value = over.entries ?? [entry({})];
							if (value instanceof Error) throw value;
							return value;
						},
						read: async (checkpointId, path) => {
							reads.push({checkpointId, path});
							const value = over.reads?.[path] ?? {
								kind: 'text',
								content: 'before\n',
							};
							if (value instanceof Error) throw value;
							return value;
						},
					},
		compare: async (_projectId, path, before) => {
			calls.push({before, path});
			return over.compared ?? textDiff(path);
		},
	});
	return {service, calls, reads};
}

const ask = (service: AgentChangesService, path = 'a.txt') =>
	service.diff({projectId: 'p', path});

test('GIT-09 only the agent lines are shown, compared with the earliest before-image of the turn', async t => {
	const {service, calls, reads} = setup({
		entries: [
			entry({id: 'c2', seq: 2}),
			entry({id: 'c1', seq: 1}),
			entry({id: 'old', seq: 0, truncateToMessageIndex: 0}),
		],
	});
	t.like(await ask(service), {kind: 'text', path: 'a.txt', added: 1});
	t.deepEqual(reads, [{checkpointId: 'c1', path: 'a.txt'}]);
	t.deepEqual(calls, [{before: 'before\n', path: 'a.txt'}]);
});

test('GIT-09 a file the turn created is shown as all added', async t => {
	const {service, calls, reads} = setup({
		entries: [entry({filesChanged: ['a.txt'], createdFiles: ['a.txt']})],
	});
	t.like(await ask(service), {kind: 'text'});
	t.deepEqual(calls, [{before: null, path: 'a.txt'}]);
	t.deepEqual(reads, []);
});

test('GIT-10 every missing snapshot falls back with its own reason and the label stays', async t => {
	const cases: Array<[string, ReturnType<typeof setup>, RegExp]> = [
		['gate off', setup({enabled: false}), /not offered/],
		['no turn', setup({turn: null}), /no turn/i],
		['running', setup({turn: {running: true}}), /still working/i],
		['not touched', setup({turn: {touched: []}}), /did not edit this file/i],
		['no session', setup({session: false}), /no longer has this chat/i],
		['list fails', setup({entries: new Error('x')}), /could not list/i],
		['no checkpoint', setup({entries: []}), /took no snapshot/i],
		[
			'binary or pruned',
			setup({
				reads: {'a.txt': {kind: 'unavailable', reason: 'pruned or binary'}},
			}),
			/pruned or binary/,
		],
		[
			'read fails',
			setup({reads: {'a.txt': new Error('x')}}),
			/could not read/i,
		],
		[
			'binary now',
			setup({
				compared: {
					path: 'a.txt',
					staged: false,
					kind: 'binary',
					reason: 'This is a binary file, so there is no text diff.',
				},
			}),
			/binary/,
		],
		[
			'too large',
			setup({
				compared: {
					path: 'a.txt',
					staged: false,
					kind: 'too-large',
					reason: 'larger than 1 MiB',
				},
			}),
			/larger than 1 MiB/,
		],
	];
	for (const [name, {service}, reason] of cases) {
		const result = await ask(service);
		t.is(result.kind, 'fallback', name);
		if (result.kind === 'fallback') t.regex(result.reason, reason, name);
	}
});

test('GIT-09 a file the agent left as it was reports no change', async t => {
	const {service} = setup({
		compared: {path: 'a.txt', staged: false, kind: 'none', reason: 'same'},
	});
	t.like(await ask(service), {kind: 'none'});
});

test('SEC-03 a path that is not a plain relative path is refused before Nanocoder or Git are asked', async t => {
	const {service, calls, reads} = setup({turn: {touched: ['../x']}});
	for (const path of ['../x', '/etc/passwd', '', 'a/../../b'])
		await t.throwsAsync(ask(service, path), {instanceOf: IpcFailure});
	t.deepEqual(calls, []);
	t.deepEqual(reads, []);
});

test('GIT-09 availability follows the capability gate', t => {
	t.deepEqual(setup().service.availability('p'), {enabled: true, reason: null});
	t.deepEqual(setup({enabled: false}).service.availability('p'), {
		enabled: false,
		reason: 'not offered',
	});
});
