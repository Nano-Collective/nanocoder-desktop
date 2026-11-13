import test from 'ava';
import type {FilesRuntime} from '@/main/files/runtime';
import {registerFilesHandlers} from '@/main/ipc/files';
import {handleRequest, type Sender} from '@/main/ipc/handle-request';
import {APP_ORIGIN} from '@/main/security';
import {FILES_CHANNELS} from '@/shared/files';
import type {IpcResult} from '@/shared/ipc';
import {REVIEW_CHANNELS} from '@/shared/review';

const projectId = '11111111-1111-4111-8111-111111111111';
const sender: Sender = {url: `${APP_ORIGIN}/index.html`, isMainFrame: true};

type Handler = (
	payload: unknown,
	source?: Sender,
) => Promise<IpcResult<unknown>>;

function fixture(withRuntime = true) {
	const calls: string[] = [];
	const handlers = new Map<string, Handler>();
	const runtime = {
		files: {
			list: async () => (calls.push('list'), {entries: []}),
			preview: async () => (calls.push('preview'), {kind: 'text'}),
			locate: async (_project: string, path: string) => {
				calls.push(`locate:${path}`);
				return {resolved: {real: `/work/app/${path}`}};
			},
		},
		editor: {
			open: async (file: string, line?: number) => {
				calls.push(`open:${file}:${line}`);
				return {editor: 'system'};
			},
			reveal: (file: string) => calls.push(`reveal:${file}`),
		},
		review: {
			status: async () => (
				calls.push('status'), {available: false, reason: 'x'}
			),
			diff: async () => (calls.push('diff'), {kind: 'none'}),
			agentDiff: async () => (calls.push('agentDiff'), {kind: 'fallback'}),
		},
	} as unknown as FilesRuntime;
	registerFilesHandlers(
		(channel, schema, handler, allowedOrigins) => {
			handlers.set(channel, (payload, source = sender) =>
				handleRequest({
					sender: source,
					payload,
					schema,
					handler,
					allowedOrigins,
				}),
			);
		},
		[APP_ORIGIN],
		withRuntime ? runtime : undefined,
	);
	const call = (channel: string, payload: unknown, source?: Sender) => {
		const handler = handlers.get(channel);
		if (!handler) throw new Error(`missing ${channel}`);
		return handler(payload, source);
	};
	return {calls, call};
}

const all = [
	...Object.values(FILES_CHANNELS).filter(
		channel => channel !== FILES_CHANNELS.event,
	),
	...Object.values(REVIEW_CHANNELS),
];

const valid = (channel: string): Record<string, unknown> =>
	channel === REVIEW_CHANNELS.status
		? {projectId}
		: channel === REVIEW_CHANNELS.diff
			? {projectId, path: 'a', staged: true}
			: {projectId, path: 'a'};

test('SEC-02 every file and review channel is registered and answers a valid request', async t => {
	t.is(all.length, 7);
	const f = fixture();
	for (const channel of all)
		t.true((await f.call(channel, valid(channel))).ok, channel);
});

test('SEC-02 requests with extra fields, bad ids or oversized paths are refused before any work', async t => {
	const f = fixture();
	for (const [channel, payload] of [
		[FILES_CHANNELS.list, {projectId, path: '', root: '/etc'}],
		[FILES_CHANNELS.list, {projectId: 'not-a-uuid', path: ''}],
		[FILES_CHANNELS.list, {projectId, path: 'a'.repeat(4_097)}],
		[FILES_CHANNELS.list, {projectId}],
		[FILES_CHANNELS.preview, {projectId, path: 5}],
		[FILES_CHANNELS.openInEditor, {projectId, path: 'a', line: 0}],
		[FILES_CHANNELS.openInEditor, {projectId, path: 'a', line: 1.5}],
		[FILES_CHANNELS.openInEditor, {projectId, path: 'a', editor: 'rm'}],
		[FILES_CHANNELS.reveal, {projectId, path: 'a', command: 'x'}],
		[REVIEW_CHANNELS.status, {projectId, extra: true}],
		[REVIEW_CHANNELS.diff, {projectId, path: '', staged: true}],
		[REVIEW_CHANNELS.diff, {projectId, path: 'a', staged: 'yes'}],
		[REVIEW_CHANNELS.diff, {projectId, path: 'a'}],
		[REVIEW_CHANNELS.agentDiff, {projectId, path: ''}],
		[REVIEW_CHANNELS.agentDiff, {projectId, path: 'a', staged: true}],
		[REVIEW_CHANNELS.agentDiff, {projectId, path: 'a', sessionId: 's'}],
		[REVIEW_CHANNELS.agentDiff, {projectId, path: 'a', checkpointId: 'c'}],
		[REVIEW_CHANNELS.agentDiff, {projectId, path: 'a'.repeat(4_097)}],
	] as const) {
		const result = await f.call(channel, payload);
		t.false(result.ok, JSON.stringify(payload));
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	t.deepEqual(f.calls, []);
});

test('SEC-02 every channel refuses foreign origins and child frames', async t => {
	const f = fixture();
	for (const channel of all)
		for (const source of [
			{url: 'https://example.com/', isMainFrame: true},
			{url: `${APP_ORIGIN}/index.html`, isMainFrame: false},
		]) {
			const result = await f.call(channel, valid(channel), source);
			t.false(result.ok, channel);
			if (!result.ok) t.is(result.error.code, 'DENIED');
		}
	t.deepEqual(f.calls, []);
});

test('FILE-06 FILE-07 opening and revealing launch only the contained, resolved path', async t => {
	const f = fixture();
	t.true(
		(
			await f.call(FILES_CHANNELS.openInEditor, {
				projectId,
				path: 'src/a.ts',
				line: 7,
			})
		).ok,
	);
	t.true(
		(await f.call(FILES_CHANNELS.reveal, {projectId, path: 'src/a.ts'})).ok,
	);
	t.deepEqual(f.calls, [
		'locate:src/a.ts',
		'open:/work/app/src/a.ts:7',
		'locate:src/a.ts',
		'reveal:/work/app/src/a.ts',
	]);
});

test('FILE-09 reads and review route to their services', async t => {
	const f = fixture();
	await f.call(FILES_CHANNELS.list, {projectId, path: 'src'});
	await f.call(FILES_CHANNELS.preview, {projectId, path: 'src/a.ts'});
	await f.call(REVIEW_CHANNELS.status, {projectId});
	await f.call(REVIEW_CHANNELS.diff, {
		projectId,
		path: 'src/a.ts',
		staged: false,
	});
	await f.call(REVIEW_CHANNELS.agentDiff, {projectId, path: 'src/a.ts'});
	t.deepEqual(f.calls, ['list', 'preview', 'status', 'diff', 'agentDiff']);
});

test('FILE-09 without a runtime every channel answers UNAVAILABLE instead of throwing', async t => {
	const f = fixture(false);
	for (const channel of all) {
		const result = await f.call(channel, valid(channel));
		t.false(result.ok, channel);
		if (!result.ok) t.is(result.error.code, 'UNAVAILABLE');
	}
});
