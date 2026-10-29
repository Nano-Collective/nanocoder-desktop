import {randomUUID} from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {ConnectOptions} from '@/main/nanocoder/acp-client';
import {fakeEvents, fakeRuntime} from '@/main/nanocoder/fixtures/fake-project';
import {connectProject} from '@/main/nanocoder/open-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {desktopStoreFactory} from '@/main/store';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import {createThreadService} from '@/main/threads/thread-service';
import type {ProjectEvent, ProjectInfo, ThreadInfo} from '@/shared/ipc';

async function fixture(
	t: ExecutionContext,
	enableRuntime = false,
	onEvent?: (event: ProjectEvent) => void,
) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-threads-')),
	);
	const store = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	const calls: string[] = [];
	const projectRoot = path.join(root, 'project');
	mkdirSync(projectRoot);
	let update: ConnectOptions['onSessionUpdate'];
	const supervisor = new ProjectSupervisor({
		resolveRuntime: async () => {
			calls.push('launch');
			if (enableRuntime)
				return {
					ok: true,
					runtime: {
						...fakeRuntime,
						nodeVersion: process.version,
						version: '9.9.9',
						source: 'override',
					},
				};
			throw new Error('Metadata operations must not start Nanocoder');
		},
		clientInfo: {name: 'thread-fixture', version: '0.0.0'},
		confirmTrust: async () => false,
		connect: options => {
			update = options.onSessionUpdate;
			return connectProject(options);
		},
	});
	t.teardown(async () => {
		await supervisor.close();
		service.dispose();
		store.close();
		rmSync(root, {recursive: true, force: true});
	});
	const project: ProjectInfo = {
		id: randomUUID(),
		canonicalRoot: projectRoot,
		sessionCwd: projectRoot,
		displayName: 'fixture',
		trusted: enableRuntime,
		defaultMode: 'auto-accept',
		lastOpenedAt: '2026-10-29T12:00:00.000Z',
		createdAt: '2026-10-29T12:00:00.000Z',
		availability: 'available',
	};
	store.projects.save(project);
	const service = createThreadService({
		store,
		supervisor,
		now: () => new Date('2026-10-30T14:00:00.000Z'),
		onEvent,
	});
	return {
		root,
		store,
		calls,
		project,
		supervisor,
		service,
		notify: (sessionId: string, text: string) => {
			if (!update) throw new Error('No fixture connection is ready');
			update({
				sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: {type: 'text', text},
				},
			});
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function seed(
	project: ProjectInfo,
	overrides: Partial<ThreadInfo> = {},
): ThreadInfo {
	return {
		id: randomUUID(),
		projectId: project.id,
		nanocoderSessionId: randomUUID(),
		title: 'fixture thread',
		archiveState: 'active',
		runState: 'ready',
		lastActivityAt: '2026-10-29T12:00:00.000Z',
		sessionCwd: project.sessionCwd,
		mode: 'normal',
		viewOnlyReason: null,
		...overrides,
	};
}

test('new thread is metadata-only until the first prompt (CHAT-03, CHAT-04)', async t => {
	const {project, service, store, calls} = await fixture(t);
	const thread = await service.createThread({projectId: project.id});
	t.regex(thread.id, /^[0-9a-f-]{36}$/);
	t.deepEqual(thread, {
		id: thread.id,
		projectId: project.id,
		nanocoderSessionId: null,
		title: 'new thread',
		archiveState: 'active',
		runState: 'new',
		lastActivityAt: '2026-10-30T14:00:00.000Z',
		sessionCwd: project.sessionCwd,
		mode: 'auto-accept',
		viewOnlyReason: null,
	});
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	t.is(store.getUiState().activeProjectId, project.id);
	t.is(store.getUiState().activeThreadId, thread.id);
	t.deepEqual(calls, []);
});

test('first prompt saves the mode-ready session ID before content is published (CHAT-04)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, store, supervisor} = await fixture(
		t,
		true,
		event => {
			if (event.type === 'turn') {
				t.truthy(
					store.threads.get(project.id, event.threadId)?.nanocoderSessionId,
				);
				events.push(event);
			}
		},
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	connection.prompt = async (sessionId, text) => {
		t.is(
			store.threads.get(project.id, thread.id)?.nanocoderSessionId,
			sessionId,
		);
		t.is(text, 'fixture first prompt');
		return {stopReason: 'end_turn'};
	};
	t.deepEqual(
		await service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture first prompt',
		}),
		{stopReason: 'end_turn'},
	);
	const snapshot = await service.getThreadSnapshot({
		projectId: project.id,
		threadId: thread.id,
	});
	t.is(snapshot.thread.nanocoderSessionId, 'fake-session');
	t.is(snapshot.thread.runState, 'ready');
	t.is(snapshot.thread.title, 'fixture first prompt');
	t.deepEqual(snapshot.events, [{type: 'user', text: 'fixture first prompt'}]);
	t.is(snapshot.replaying, false);
	t.deepEqual(events, [
		{
			type: 'turn',
			projectId: project.id,
			threadId: thread.id,
			sequence: 1,
			events: [{type: 'user', text: 'fixture first prompt'}],
		},
	]);
	await supervisor.close();
	const requests = fakeEvents(connection.stderr.lines()).filter(
		event => typeof event.method === 'string',
	);
	t.deepEqual(
		requests
			.filter(event => String(event.method).startsWith('session/'))
			.map(event => event.method),
		['session/new', 'session/set_mode', 'session/close'],
	);
	t.is(
		(
			requests.find(event => event.method === 'session/set_mode')?.params as
				| {modeId?: string}
				| undefined
		)?.modeId,
		'auto-accept',
	);
});

test('unknown project cannot create a thread (CHAT-03)', async t => {
	const {service, calls} = await fixture(t);
	const error = await t.throwsAsync(
		service.createThread({projectId: randomUUID()}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'NOT_FOUND');
	t.deepEqual(calls, []);
});

test('thread lists are activity-ordered, project-scoped and archive-separated (CHAT-03, CHAT-13)', async t => {
	const {root, project, store, service, calls} = await fixture(t);
	const earlier = seed(project);
	const today = seed(project, {
		lastActivityAt: '2026-10-30T12:00:00.000Z',
	});
	const archived = seed(project, {archiveState: 'archived'});
	const otherRoot = path.join(root, 'other');
	mkdirSync(otherRoot);
	const other = {
		...project,
		id: randomUUID(),
		canonicalRoot: otherRoot,
		sessionCwd: otherRoot,
	};
	store.projects.save(other);
	for (const thread of [earlier, today, archived, seed(other)])
		store.threads.save(thread);
	t.deepEqual(
		await service.listThreads({projectId: project.id, archiveState: 'active'}),
		[today, earlier],
	);
	t.deepEqual(
		await service.listThreads({
			projectId: project.id,
			archiveState: 'archived',
		}),
		[archived],
	);
	t.deepEqual(calls, []);
});

test('archive and unarchive change only desktop metadata (CHAT-13)', async t => {
	const {project, service, store, calls} = await fixture(t);
	const thread = seed(project);
	store.threads.save(thread);
	const request = {projectId: project.id, threadId: thread.id};
	t.deepEqual(await service.archiveThread({...request, archived: true}), {
		...thread,
		archiveState: 'archived',
	});
	t.deepEqual(store.threads.list(project.id, 'active'), []);
	t.deepEqual(
		await service.archiveThread({...request, archived: false}),
		thread,
	);
	t.deepEqual(store.threads.list(project.id, 'archived'), []);
	t.deepEqual(calls, []);
});

test('remove keeps upstream history and cleans only the removed desktop selection (CHAT-14, DATA-07)', async t => {
	const {project, service, store, calls} = await fixture(t);
	const thread = seed(project);
	const kept = seed(project);
	store.threads.save(thread);
	store.threads.save(kept);
	store.updateUiState({
		activeProjectId: project.id,
		activeThreadId: thread.id,
		openThreadIds: [thread.id, kept.id],
	});
	t.is(
		await service.removeThread({projectId: project.id, threadId: thread.id}),
		null,
	);
	t.is(store.threads.get(project.id, thread.id), undefined);
	t.deepEqual(store.threads.get(project.id, kept.id), kept);
	t.is(store.getUiState().activeProjectId, project.id);
	t.is(store.getUiState().activeThreadId, null);
	t.deepEqual(store.getUiState().openThreadIds, [kept.id]);
	t.deepEqual(calls, []);
});

test('cross-project thread mutations refuse before any side effect (CHAT-14)', async t => {
	const {root, project, service, store, calls} = await fixture(t);
	const otherRoot = path.join(root, 'other');
	mkdirSync(otherRoot);
	const other = {
		...project,
		id: randomUUID(),
		canonicalRoot: otherRoot,
		sessionCwd: otherRoot,
	};
	store.projects.save(other);
	const thread = seed(other);
	store.threads.save(thread);
	const request = {projectId: project.id, threadId: thread.id};
	for (const work of [
		() => service.archiveThread({...request, archived: true}),
		() => service.removeThread(request),
	]) {
		const error = await t.throwsAsync(work(), {instanceOf: IpcFailure});
		t.is((error as IpcFailure).code, 'NOT_FOUND');
	}
	t.deepEqual(store.threads.get(other.id, thread.id), thread);
	t.deepEqual(calls, []);
});

test('first prompt refuses an untrusted project without starting Nanocoder (CHAT-04, SEC-17)', async t => {
	const {project, service, store, calls} = await fixture(t);
	const thread = await service.createThread({projectId: project.id});
	const error = await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture prompt',
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
	t.is(store.threads.get(project.id, thread.id)?.nanocoderSessionId, null);
	t.deepEqual(calls, []);
});

test('first prompt refuses a moved project root before execution (CHAT-04, SEC-17)', async t => {
	const {project, service, store, calls} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	renameSync(project.canonicalRoot, `${project.canonicalRoot}-moved`);
	const error = await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture prompt',
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
	t.is(store.threads.get(project.id, thread.id)?.nanocoderSessionId, null);
	t.deepEqual(calls, []);
});

test('failed mode preparation stores no session and publishes no content (CHAT-04, DEC-31)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, store} = await fixture(t, true, event => {
		if (event.type === 'turn') events.push(event);
	});
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'mode-fails',
	);
	const thread = await service.createThread({projectId: project.id});
	const error = await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture prompt',
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'AGENT_UNAVAILABLE');
	t.is(store.threads.get(project.id, thread.id)?.nanocoderSessionId, null);
	t.deepEqual(events, []);
});

test('concurrent first sends cannot create two sessions in one project (CHAT-04, DEC-07)', async t => {
	const {project, service, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const entered = deferred<void>();
	const release = deferred<void>();
	const original = connection.newSession;
	let creations = 0;
	connection.newSession = async mode => {
		creations++;
		if (creations > 1) throw new Error('Duplicate session preparation');
		entered.resolve();
		await release.promise;
		return original(mode);
	};
	connection.prompt = async () => ({stopReason: 'end_turn'});
	const request = {
		projectId: project.id,
		threadId: thread.id,
		text: 'fixture prompt',
	};
	const first = service.promptThread(request);
	const handled = first.catch(() => undefined);
	await entered.promise;
	let error: Error | undefined;
	try {
		error = await t.throwsAsync(service.promptThread(request), {
			instanceOf: IpcFailure,
		});
	} finally {
		release.resolve();
		await handled;
	}
	t.is((error as IpcFailure).code, 'BUSY');
	t.is(creations, 1);
	t.deepEqual(await first, {stopReason: 'end_turn'});
});

test('live updates map only the saved session to its desktop thread (CHAT-04)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, supervisor, notify} = await fixture(
		t,
		true,
		event => {
			if (event.type === 'turn') events.push(event);
		},
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).prompt = async () => {
		notify('foreign-session', 'must not appear');
		notify('fake-session', 'fixture response');
		return {stopReason: 'end_turn'};
	};
	const request = {
		projectId: project.id,
		threadId: thread.id,
		text: 'fixture prompt',
	};
	await service.promptThread(request);
	const snapshot = await service.getThreadSnapshot(request);
	t.deepEqual(snapshot.events, [
		{type: 'user', text: 'fixture prompt'},
		{type: 'text', text: 'fixture response'},
	]);
	t.is(snapshot.sequence, 2);
	t.deepEqual(
		events.map(event => event.sequence),
		[1, 2],
	);
	t.true(
		events.every(
			event => event.type === 'turn' && event.threadId === thread.id,
		),
	);
});

test('turn completion preserves title metadata updated during the turn (CHAT-12)', async t => {
	const {project, service, store, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).prompt = async () => {
		const current = store.threads.get(project.id, thread.id);
		if (!current) throw new Error('Missing fixture thread');
		store.threads.save({...current, title: 'fixture generated title'});
		return {stopReason: 'end_turn'};
	};
	await service.promptThread({
		projectId: project.id,
		threadId: thread.id,
		text: 'fixture prompt',
	});
	t.is(
		store.threads.get(project.id, thread.id)?.title,
		'fixture generated title',
	);
});
