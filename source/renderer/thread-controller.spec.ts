import test from 'ava';
import {createThreadController} from '@/renderer/thread-controller';
import type {IpcResult, ProjectEvent, ThreadInfo} from '@/shared/ipc';

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
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
};

function fixture() {
	let listener: ((event: ProjectEvent) => void) | undefined;
	const calls: unknown[] = [];
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
	});
	return {
		bridge,
		calls,
		controller,
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
