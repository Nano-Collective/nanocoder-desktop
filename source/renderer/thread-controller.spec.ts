import test from 'ava';
import {createThreadController} from '@/renderer/thread-controller';
import type {
	IpcResult,
	ProjectEvent,
	ThreadInfo,
	ThreadRequest,
	ThreadSnapshot,
	TurnResult,
	WorkspaceRequests,
} from '@/shared/ipc';

const ok = <T>(value: T): IpcResult<T> => ({ok: true, value});
const row = (id: string, projectId = 'project-a'): ThreadInfo => ({
	id,
	projectId,
	nanocoderSessionId: null,
	title: id,
	archiveState: 'active',
	runState: 'new',
	lastActivityAt: '2026-10-30T14:00:00.000Z',
	sessionCwd: '/fixture',
	mode: 'normal',
	viewOnlyReason: null,
});
const snap = (id: string, sequence = 0): ThreadSnapshot => ({
	thread: row(id),
	sequence,
	replaying: false,
	events: sequence ? [{type: 'text', text: `prefix ${sequence}`}] : [],
});
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return {promise, resolve, reject};
};

function fixture() {
	let listener: ((event: ProjectEvent) => void) | undefined;
	const calls: unknown[] = [];
	const delivered: Array<
		| {type: 'snapshot'; value: ThreadSnapshot}
		| {type: 'turn'; value: Extract<ProjectEvent, {type: 'turn'}>}
	> = [];
	const removed: string[] = [];
	const bridge = {
		listThreads: async (request: {
			projectId: string;
			archiveState: 'active' | 'archived';
		}) => {
			calls.push(['list', request]);
			return ok<ThreadInfo[]>([]);
		},
		createThread: async (request: {projectId: string}) => {
			calls.push(['create', request]);
			return ok(row('created', request.projectId));
		},
		openThread: async (request: ThreadRequest) => {
			calls.push(['open', request]);
			return ok(snap(request.threadId));
		},
		getThreadSnapshot: async (request: ThreadRequest) => {
			calls.push(['snapshot', request]);
			return ok(snap(request.threadId));
		},
		renameThread: async (request: ThreadRequest & {title: string}) => {
			calls.push(['rename', request]);
			return ok({
				...row(request.threadId, request.projectId),
				title: request.title,
			});
		},
		setThreadMode: async (request: WorkspaceRequests['setThreadMode']) => {
			calls.push(['mode', request]);
			return ok({
				...row(request.threadId, request.projectId),
				mode: request.mode,
			});
		},
		archiveThread: async (request: ThreadRequest & {archived: boolean}) => {
			calls.push(['archive', request]);
			return ok({
				...row(request.threadId, request.projectId),
				archiveState: request.archived
					? ('archived' as const)
					: ('active' as const),
			});
		},
		removeThread: async (request: ThreadRequest) => {
			calls.push(['remove', request]);
			return ok(null);
		},
		deleteThreadHistory: async (
			request: ThreadRequest,
		): Promise<IpcResult<{status: 'deleted' | 'cancelled'}>> => {
			calls.push(['delete-history', request]);
			return ok({status: 'cancelled'});
		},
		promptThread: async (
			request: WorkspaceRequests['promptThread'],
		): Promise<IpcResult<TurnResult>> => {
			calls.push(['prompt', request]);
			return ok({stopReason: 'end_turn'});
		},
		cancelThread: async (request: ThreadRequest): Promise<IpcResult<null>> => {
			calls.push(['cancel', request]);
			return ok(null);
		},
		answerThreadPermission: async (
			request: WorkspaceRequests['answerThreadPermission'],
		): Promise<IpcResult<null>> => {
			calls.push(['answer', request]);
			return ok(null);
		},
		onProjectEvent: (callback: (event: ProjectEvent) => void) => {
			listener = callback;
			return () => {
				listener = undefined;
			};
		},
	};
	const controller = createThreadController({
		bridge,
		onChange: () => undefined,
		onSnapshot: value => delivered.push({type: 'snapshot', value}),
		onTurn: value => delivered.push({type: 'turn', value}),
		onRemoved: id => removed.push(id),
	});
	return {
		bridge,
		calls,
		controller,
		delivered,
		removed,
		emit: (event: ProjectEvent) => listener?.(event),
	};
}

test('controller loads both scoped groups and creates only desktop metadata for its selected project (CHAT-03, CHAT-04)', async t => {
	const {bridge, calls, controller} = fixture();
	const active = row('active');
	const archived = {...row('archived'), archiveState: 'archived' as const};
	bridge.listThreads = async request =>
		ok(request.archiveState === 'active' ? [active] : [archived]);
	await controller.selectProject('project-a');
	t.deepEqual(controller.getState().threads, [active, archived]);
	t.true(await controller.create());
	t.deepEqual(calls, [['create', {projectId: 'project-a'}]]);
	t.is(controller.getState().activeThreadId, 'created');
	t.is(controller.getState().threads.at(-1)?.nanocoderSessionId, null);
});

test('project switching ignores late list and create results from the old scope (CHAT-03)', async t => {
	const {bridge, controller} = fixture();
	const old = deferred<IpcResult<ThreadInfo[]>>();
	bridge.listThreads = request =>
		request.projectId === 'project-a'
			? old.promise
			: Promise.resolve(ok([row('b', 'project-b')]));
	const initial = controller.selectProject('project-a');
	await controller.selectProject('project-b');
	old.resolve(ok([row('a')]));
	await initial;
	t.is(controller.getState().projectId, 'project-b');
	t.deepEqual(controller.getState().threads, [row('b', 'project-b')]);
	const creating = deferred<IpcResult<ThreadInfo>>();
	bridge.createThread = () => creating.promise;
	const pending = controller.create();
	await controller.selectProject('project-a');
	creating.resolve(ok(row('stale-created', 'project-b')));
	t.false(await pending);
	t.is(controller.getState().projectId, 'project-a');
	t.is(controller.getState().activeThreadId, null);
});

test('metadata events use the common project sequence and never resurrect a removed row from a late list (CHAT-03, CHAT-14)', async t => {
	const {bridge, controller, emit} = fixture();
	const result = deferred<IpcResult<ThreadInfo[]>>();
	bridge.listThreads = () => result.promise;
	const selecting = controller.selectProject('project-a');
	const changed = {...row('changed'), title: 'latest title'};
	emit({type: 'thread', projectId: 'project-a', sequence: 2, thread: changed});
	emit({
		type: 'thread-removed',
		projectId: 'project-a',
		sequence: 3,
		threadId: 'removed',
	});
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 1,
		thread: row('changed'),
	});
	emit({
		type: 'thread',
		projectId: 'project-b',
		sequence: 99,
		thread: row('foreign', 'project-b'),
	});
	result.resolve(ok([row('changed'), row('removed'), row('unchanged')]));
	await selecting;
	t.deepEqual(controller.getState().threads, [changed, row('unchanged')]);
});

test('disposal drops late async work and detaches metadata delivery (CHAT-03)', async t => {
	const {bridge, controller, emit} = fixture();
	const result = deferred<IpcResult<ThreadInfo[]>>();
	bridge.listThreads = () => result.promise;
	const selecting = controller.selectProject('project-a');
	controller.dispose();
	const before = controller.getState();
	result.resolve(ok([row('late')]));
	await selecting;
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 10,
		thread: row('late'),
	});
	t.deepEqual(controller.getState(), before);
});

test('controller refuses duplicate create work and action calls after disposal (CHAT-04)', async t => {
	const {bridge, controller} = fixture();
	t.false(await controller.create());
	await controller.selectProject('project-a');
	const result = deferred<IpcResult<ThreadInfo>>();
	let creates = 0;
	bridge.createThread = () => {
		creates++;
		return result.promise;
	};
	const first = controller.create();
	t.true(controller.getState().pending);
	t.false(await controller.create());
	controller.dispose();
	result.resolve(ok(row('late')));
	t.false(await first);
	t.false(await controller.create());
	t.is(creates, 1);
});

test('metadata actions use their selected project and keep remove distinct from cancelled history deletion (CHAT-12, CHAT-13, CHAT-14)', async t => {
	const {controller, calls} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	calls.length = 0;
	t.true(await controller.rename('created', 'fixture renamed'));
	t.true(await controller.archive('created', true));
	t.is(controller.getState().threads[0]?.archiveState, 'archived');
	t.false(await controller.deleteHistory('created'));
	t.is(controller.getState().threads.length, 1);
	t.true(await controller.remove('created'));
	t.deepEqual(controller.getState().threads, []);
	t.is(controller.getState().activeThreadId, null);
	t.deepEqual(calls, [
		[
			'rename',
			{projectId: 'project-a', threadId: 'created', title: 'fixture renamed'},
		],
		['archive', {projectId: 'project-a', threadId: 'created', archived: true}],
		['delete-history', {projectId: 'project-a', threadId: 'created'}],
		['remove', {projectId: 'project-a', threadId: 'created'}],
	]);
});

test('mode action waits for main without optimism or a session and honours native cancellation (DEC-31 CHAT-04)', async t => {
	const {bridge, controller, calls} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	calls.length = 0;
	const result = deferred<IpcResult<ThreadInfo>>();
	bridge.setThreadMode = request => {
		calls.push(['mode', request]);
		return result.promise;
	};
	const pending = controller.setMode('created', 'yolo');
	t.true(controller.getState().pending);
	t.is(controller.getState().threads[0]?.mode, 'normal');
	t.false(await controller.setMode('created', 'plan'));
	t.deepEqual(calls, [
		['mode', {projectId: 'project-a', threadId: 'created', mode: 'yolo'}],
	]);
	result.resolve(ok(row('created')));
	t.true(await pending);
	t.is(controller.getState().threads[0]?.mode, 'normal');
	t.false(controller.getState().pending);
});

test('newer main metadata, removal, project switches and disposal win over late mode results (CHAT-17 DEC-31)', async t => {
	for (const change of ['metadata', 'remove', 'project', 'dispose']) {
		const {bridge, controller, emit} = fixture();
		await controller.selectProject('project-a');
		await controller.create();
		const result = deferred<IpcResult<ThreadInfo>>();
		bridge.setThreadMode = () => result.promise;
		const pending = controller.setMode('created', 'yolo');
		if (change === 'metadata')
			emit({
				type: 'thread',
				projectId: 'project-a',
				sequence: 10,
				thread: {...row('created'), mode: 'normal', title: 'fresh main row'},
			});
		if (change === 'remove')
			emit({
				type: 'thread-removed',
				projectId: 'project-a',
				sequence: 10,
				threadId: 'created',
			});
		if (change === 'project') await controller.selectProject('project-b');
		if (change === 'dispose') controller.dispose();
		result.resolve(ok({...row('created'), mode: 'yolo'}));
		t.is(await pending, change === 'metadata');
		t.false(
			controller.getState().threads.some(thread => thread.mode === 'yolo'),
		);
	}
});

test('mode refuses read-only rows and a turn in any project thread before sending IPC (CHAT-17)', async t => {
	for (const change of [
		'archived',
		'view-only',
		'running',
		'waiting-approval',
	] as const) {
		const {controller, calls, emit} = fixture();
		await controller.selectProject('project-a');
		await controller.create();
		calls.length = 0;
		const blocked =
			change === 'archived'
				? {...row('created'), archiveState: 'archived' as const}
				: change === 'view-only'
					? {...row('created'), runState: change}
					: {...row('other'), runState: change};
		emit({
			type: 'thread',
			projectId: 'project-a',
			sequence: 1,
			thread: blocked,
		});
		t.false(await controller.setMode('created', 'plan'));
		t.deepEqual(calls, []);
	}
});

test('mode refuses a locally preparing turn and cancellation still settling (CHAT-17)', async t => {
	const {bridge, controller, calls} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	const result = deferred<IpcResult<TurnResult>>();
	const cancelled = deferred<IpcResult<null>>();
	bridge.promptThread = () => result.promise;
	bridge.cancelThread = () => cancelled.promise;
	const prompting = controller.prompt('created', 'fixture');
	calls.length = 0;
	t.false(await controller.setMode('created', 'plan'));
	const cancelling = controller.cancel('created');
	result.resolve(ok({stopReason: 'cancelled'}));
	await prompting;
	t.false(await controller.setMode('created', 'plan'));
	t.deepEqual(calls, []);
	cancelled.resolve(ok(null));
	await cancelling;
});

test('late action responses cannot roll back newer metadata or resurrect a removed thread (CHAT-12, CHAT-14)', async t => {
	const {bridge, controller, emit} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	const rename = deferred<IpcResult<ThreadInfo>>();
	bridge.renameThread = () => rename.promise;
	const pending = controller.rename('created', 'stale title');
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 4,
		thread: {...row('created'), title: 'newer title'},
	});
	rename.resolve(ok({...row('created'), title: 'stale title'}));
	t.true(await pending);
	t.is(controller.getState().threads[0]?.title, 'newer title');
	const archive = deferred<IpcResult<ThreadInfo>>();
	bridge.archiveThread = () => archive.promise;
	const removing = controller.archive('created', true);
	emit({
		type: 'thread-removed',
		projectId: 'project-a',
		sequence: 5,
		threadId: 'created',
	});
	archive.resolve(ok({...row('created'), archiveState: 'archived'}));
	t.false(await removing);
	t.deepEqual(controller.getState().threads, []);
});

test('unknown pending and disposed metadata actions refuse without extra bridge calls and preserve failed mutations (CHAT-12, CHAT-14)', async t => {
	const {bridge, controller, calls} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	calls.length = 0;
	t.false(await controller.remove('unknown'));
	const result = deferred<IpcResult<ThreadInfo>>();
	bridge.renameThread = request => {
		calls.push(['rename', request]);
		return result.promise;
	};
	const renaming = controller.rename('created', 'not saved');
	t.false(await controller.remove('created'));
	result.resolve({
		ok: false,
		error: {
			code: 'UNSUPPORTED',
			message: 'fixture rename unavailable',
			retryable: false,
		},
	});
	t.false(await renaming);
	t.is(controller.getState().error, 'fixture rename unavailable');
	t.is(controller.getState().threads[0]?.title, 'created');
	controller.dispose();
	t.false(await controller.archive('created', true));
	t.is(calls.length, 1);
});

test('controller opens or reads only the selected desktop thread and routes a main snapshot (CHAT-03, CHAT-04)', async t => {
	const {controller, calls, delivered} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	calls.length = 0;
	t.true(await controller.open('created'));
	t.true(await controller.read('created'));
	t.deepEqual(calls, [
		['open', {projectId: 'project-a', threadId: 'created'}],
		['snapshot', {projectId: 'project-a', threadId: 'created'}],
	]);
	t.deepEqual(delivered, [
		{type: 'snapshot', value: snap('created')},
		{type: 'snapshot', value: snap('created')},
	]);
});

test('controller buffers live thread events behind an in-flight open snapshot (CHAT-04)', async t => {
	const {bridge, controller, emit, delivered} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	const result = deferred<IpcResult<ThreadSnapshot>>();
	bridge.openThread = () => result.promise;
	const opening = controller.open('created');
	const live = {
		type: 'turn',
		projectId: 'project-a',
		threadId: 'created',
		sequence: 2,
		events: [{type: 'text', text: 'newer'}],
	} as const;
	emit({...live, events: [...live.events]});
	t.deepEqual(delivered, []);
	result.resolve(ok(snap('created', 1)));
	t.true(await opening);
	t.deepEqual(delivered, [
		{type: 'snapshot', value: snap('created', 1)},
		{type: 'turn', value: live},
	]);
});

test('metadata and chat counters stay independent and a chat gap reads main without opening a session (CHAT-04)', async t => {
	const {bridge, controller, emit, delivered, calls} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	t.true(await controller.read('created'));
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 100,
		thread: {...row('created'), title: 'latest'},
	});
	const live: Extract<ProjectEvent, {type: 'turn'}> = {
		type: 'turn',
		projectId: 'project-a',
		threadId: 'created',
		sequence: 1,
		events: [{type: 'text', text: 'first'}],
	};
	emit(live);
	emit(live);
	emit({...live, projectId: 'project-b', sequence: 500});
	t.is(delivered.length, 2);
	t.is(controller.getState().threads[0]?.title, 'latest');
	const result = deferred<IpcResult<ThreadSnapshot>>();
	const requested = deferred<void>();
	bridge.getThreadSnapshot = request => {
		calls.push(['snapshot', request]);
		requested.resolve();
		return result.promise;
	};
	emit({...live, sequence: 3});
	await requested.promise;
	result.resolve(ok(snap('created', 3)));
	await Promise.resolve();
	t.is(delivered.at(-1)?.type, 'snapshot');
	if (delivered.at(-1)?.type === 'snapshot')
		t.is((delivered.at(-1)?.value as ThreadSnapshot).sequence, 3);
	t.false(calls.some(call => Array.isArray(call) && call[0] === 'open'));
});

test('a thread removed during an open cannot be restored by its old snapshot response (CHAT-14)', async t => {
	const {bridge, controller, emit, delivered, removed} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	const result = deferred<IpcResult<ThreadSnapshot>>();
	bridge.openThread = () => result.promise;
	const opening = controller.open('created');
	t.true(controller.getState().pending);
	emit({
		type: 'thread-removed',
		projectId: 'project-a',
		sequence: 4,
		threadId: 'created',
	});
	result.resolve(ok(snap('created', 2)));
	t.false(await opening);
	t.deepEqual(delivered, []);
	t.deepEqual(removed, ['created']);
	t.deepEqual(controller.getState().threads, []);
});

test('a rejected superseded gap lookup cannot replace the newer successful read with an error (CHAT-04)', async t => {
	const {bridge, controller, emit, delivered} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	t.true(await controller.read('created'));
	const gap = deferred<IpcResult<ThreadSnapshot>>();
	bridge.getThreadSnapshot = () => gap.promise;
	emit({
		type: 'turn',
		projectId: 'project-a',
		threadId: 'created',
		sequence: 2,
		events: [{type: 'text', text: 'gap'}],
	});
	bridge.getThreadSnapshot = async () => ok(snap('created', 2));
	t.true(await controller.read('created'));
	gap.reject(new Error('obsolete fixture read'));
	await gap.promise.catch(() => undefined);
	t.is(controller.getState().error, null);
	t.is(delivered.length, 2);
});

test('snapshot replies with the wrong project or desktop thread are refused without exposing their content (CHAT-04)', async t => {
	for (const thread of [row('foreign'), row('created', 'project-b')]) {
		const {bridge, controller, delivered} = fixture();
		await controller.selectProject('project-a');
		await controller.create();
		bridge.openThread = async () => ok({...snap('created', 1), thread});
		t.false(await controller.open('created'));
		t.deepEqual(delivered, []);
		t.deepEqual(controller.getState().threads, [row('created')]);
		controller.dispose();
	}
});

for (const transition of ['switch', 'dispose']) {
	test(`an outstanding snapshot cannot deliver after ${transition} (CHAT-03, CHAT-04)`, async t => {
		const {bridge, controller, delivered} = fixture();
		await controller.selectProject('project-a');
		await controller.create();
		const pending = deferred<IpcResult<ThreadSnapshot>>();
		bridge.openThread = () => pending.promise;
		const opening = controller.open('created');
		if (transition === 'switch') await controller.selectProject('project-b');
		else controller.dispose();
		const before = controller.getState();
		pending.resolve(ok(snap('created', 1)));
		t.false(await opening);
		t.deepEqual(delivered, []);
		t.deepEqual(controller.getState(), before);
	});
}

test('thread commands capture desktop ownership without inventing content or blocking selection and approval/cancel (CHAT-03, CHAT-06, ACP-10)', async t => {
	const {bridge, controller, calls, delivered, emit} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	await controller.read('created');
	calls.length = 0;
	delivered.length = 0;
	const result = deferred<IpcResult<TurnResult>>();
	const cancellation = deferred<IpcResult<null>>();
	bridge.promptThread = request => {
		calls.push(['prompt', request]);
		return result.promise;
	};
	bridge.cancelThread = request => {
		calls.push(['cancel', request]);
		return cancellation.promise;
	};
	const sending = controller.prompt('created', 'captured text');
	t.is(controller.getState().promptingThreadId, 'created');
	t.false(controller.getState().pending);
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 1,
		thread: row('peer'),
	});
	t.true(await controller.read('peer'));
	const cancelling = controller.cancel('created');
	t.deepEqual(controller.getState().cancellingThreadIds, ['created']);
	t.deepEqual(
		await controller.answer('created', 'request-a', 'offered-a'),
		ok(null),
	);
	t.deepEqual(calls, [
		[
			'prompt',
			{projectId: 'project-a', threadId: 'created', text: 'captured text'},
		],
		['snapshot', {projectId: 'project-a', threadId: 'peer'}],
		['cancel', {projectId: 'project-a', threadId: 'created'}],
		[
			'answer',
			{
				projectId: 'project-a',
				threadId: 'created',
				requestId: 'request-a',
				optionId: 'offered-a',
			},
		],
	]);
	t.deepEqual(delivered, [{type: 'snapshot', value: snap('peer')}]);
	cancellation.resolve(ok(null));
	t.deepEqual(await cancelling, ok(null));
	t.deepEqual(controller.getState().cancellingThreadIds, []);
	t.is(controller.getState().promptingThreadId, 'created');
	result.resolve(ok({stopReason: 'end_turn'}));
	t.deepEqual(await sending, ok({stopReason: 'end_turn'}));
	t.is(controller.getState().promptingThreadId, null);
	t.is(controller.getState().activeThreadId, 'peer');
	t.is(
		controller.getState().threads.find(thread => thread.id === 'created')
			?.runState,
		'new',
	);
});

test('unknown disposed archived view-only empty and metadata-pending prompts refuse without blocking scoped cancel or answers (CHAT-06, ACP-10)', async t => {
	const {bridge, controller, calls, emit} = fixture();
	t.is(await controller.prompt('missing', 'text'), null);
	t.is(await controller.cancel('missing'), null);
	t.is(await controller.answer('missing', 'request', 'option'), null);
	t.deepEqual(calls, []);
	await controller.selectProject('project-a');
	await controller.create();
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 1,
		thread: {...row('archive'), archiveState: 'archived'},
	});
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 2,
		thread: {
			...row('view'),
			runState: 'view-only',
			viewOnlyReason: 'no history',
		},
	});
	calls.length = 0;
	for (const [id, text] of [
		['created', ' \n '],
		['missing', 'text'],
		['archive', 'text'],
		['view', 'text'],
	]) {
		t.is(await controller.prompt(id, text), null);
	}
	t.is(await controller.cancel('missing'), null);
	t.is(await controller.answer('missing', 'request', 'option'), null);
	t.deepEqual(calls, []);
	const pending = deferred<IpcResult<ThreadSnapshot>>();
	bridge.openThread = () => pending.promise;
	const opening = controller.open('created');
	t.is(await controller.prompt('created', 'text'), null);
	t.deepEqual(await controller.cancel('created'), ok(null));
	t.deepEqual(
		await controller.answer('created', 'request', 'option'),
		ok(null),
	);
	pending.resolve(ok(snap('created')));
	t.true(await opening);
	t.deepEqual(calls, [
		['cancel', {projectId: 'project-a', threadId: 'created'}],
		[
			'answer',
			{
				projectId: 'project-a',
				threadId: 'created',
				requestId: 'request',
				optionId: 'option',
			},
		],
	]);
	controller.dispose();
	t.is(await controller.prompt('created', 'text'), null);
	t.is(await controller.cancel('created'), null);
	t.is(await controller.answer('created', 'request', 'option'), null);
	t.is(calls.length, 2);
});

test('a project permits one local prompt and deduplicates each pending cancel and exact approval answer (CHAT-06, ACP-10)', async t => {
	const {bridge, controller, calls, emit} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	emit({
		type: 'thread',
		projectId: 'project-a',
		sequence: 1,
		thread: row('peer'),
	});
	const result = deferred<IpcResult<TurnResult>>();
	const action = deferred<IpcResult<null>>();
	bridge.promptThread = request => {
		calls.push(['prompt', request]);
		return result.promise;
	};
	bridge.cancelThread = request => {
		calls.push(['cancel', request]);
		return action.promise;
	};
	bridge.answerThreadPermission = request => {
		calls.push(['answer', request]);
		return request.requestId === 'request-a'
			? action.promise
			: Promise.resolve(ok(null));
	};
	calls.length = 0;
	const sending = controller.prompt('created', 'first');
	t.is(await controller.prompt('created', 'duplicate'), null);
	t.is(await controller.prompt('peer', 'not queued'), null);
	const cancelling = controller.cancel('created');
	t.is(await controller.cancel('created'), null);
	const answering = controller.answer('created', 'request-a', 'offered');
	t.is(await controller.answer('created', 'request-a', 'different'), null);
	t.deepEqual(
		await controller.answer('created', 'request-b', 'offered'),
		ok(null),
	);
	t.is(calls.length, 4);
	action.resolve(ok(null));
	result.resolve(ok({stopReason: 'cancelled'}));
	await Promise.all([sending, cancelling, answering]);
	t.is(controller.getState().promptingThreadId, null);
	t.deepEqual(controller.getState().cancellingThreadIds, []);
});

for (const transition of ['switch', 'remove', 'dispose']) {
	test(`pending turn-command replies cannot re-enter state after ${transition} (CHAT-03, ACP-10)`, async t => {
		const {bridge, controller, delivered, emit} = fixture();
		await controller.selectProject('project-a');
		await controller.create();
		const result = deferred<IpcResult<TurnResult>>();
		const action = deferred<IpcResult<null>>();
		bridge.promptThread = () => result.promise;
		bridge.cancelThread = () => action.promise;
		bridge.answerThreadPermission = () => action.promise;
		const pending = [
			controller.prompt('created', 'old text'),
			controller.cancel('created'),
			controller.answer('created', 'old request', 'offered'),
		];
		if (transition === 'switch') await controller.selectProject('project-b');
		else if (transition === 'remove')
			emit({
				type: 'thread-removed',
				projectId: 'project-a',
				threadId: 'created',
				sequence: 1,
			});
		else controller.dispose();
		const before = controller.getState();
		result.resolve({
			ok: false,
			error: {code: 'DENIED', message: 'obsolete failure', retryable: false},
		});
		action.resolve(ok(null));
		t.deepEqual(await Promise.all(pending), [null, null, null]);
		t.deepEqual(controller.getState(), before);
		t.deepEqual(delivered, []);
	});
}

for (const resultKind of ['resolve', 'reject']) {
	test(`an old prompt ${resultKind} cannot unlock a new project prompt with the same local key (CHAT-03, CHAT-06)`, async t => {
		const {bridge, controller} = fixture();
		await controller.selectProject('project-a');
		await controller.create();
		const old = deferred<IpcResult<TurnResult>>();
		const fresh = deferred<IpcResult<TurnResult>>();
		bridge.promptThread = request =>
			request.projectId === 'project-a' ? old.promise : fresh.promise;
		const obsolete = controller.prompt('created', 'old');
		await controller.selectProject('project-b');
		await controller.create();
		const current = controller.prompt('created', 'new');
		if (resultKind === 'resolve') old.resolve(ok({stopReason: 'end_turn'}));
		else old.reject(new Error('obsolete transport failure'));
		t.is(await obsolete, null);
		t.is(controller.getState().promptingThreadId, 'created');
		t.is(controller.getState().projectId, 'project-b');
		t.is(controller.getState().error, null);
		fresh.resolve(ok({stopReason: 'end_turn'}));
		t.deepEqual(await current, ok({stopReason: 'end_turn'}));
		t.is(controller.getState().promptingThreadId, null);
	});
}

test('turn command transport failures clear only their own busy state and expose no thrown detail (CHAT-06, DATA-07)', async t => {
	const {bridge, controller, delivered} = fixture();
	await controller.selectProject('project-a');
	await controller.create();
	bridge.promptThread = async () => {
		throw new Error('untrusted fixture detail');
	};
	t.deepEqual(await controller.prompt('created', 'text'), {
		ok: false,
		error: {
			code: 'AGENT_UNAVAILABLE',
			message: 'the thread request could not finish',
			retryable: true,
		},
	});
	t.is(controller.getState().promptingThreadId, null);
	t.false(controller.getState().pending);
	t.is(controller.getState().threads[0]?.runState, 'new');
	t.deepEqual(delivered, []);
});
