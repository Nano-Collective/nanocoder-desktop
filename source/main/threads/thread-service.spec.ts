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
import {
	type ConnectOptions,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
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
	let confirm: NonNullable<
		Parameters<typeof createThreadService>[0]['confirmDeleteHistory']
	> = async () => false;
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
		confirmDeleteHistory: snapshot => {
			calls.push('confirm-delete');
			return confirm(snapshot);
		},
	});
	return {
		root,
		store,
		calls,
		project,
		supervisor,
		service,
		confirmDeletion: (callback: typeof confirm) => {
			confirm = callback;
		},
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

test('archive and remove refuse while the thread is preparing its first session (CHAT-04, CHAT-14)', async t => {
	const {project, service, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const entered = deferred<void>();
	const release = deferred<void>();
	const original = connection.newSession;
	connection.newSession = async mode => {
		entered.resolve();
		await release.promise;
		return original(mode);
	};
	connection.prompt = async () => ({stopReason: 'end_turn'});
	const request = {projectId: project.id, threadId: thread.id};
	const pending = service
		.promptThread({...request, text: 'fixture prompt'})
		.catch(() => undefined);
	await entered.promise;
	let outcomes: string[];
	try {
		outcomes = await Promise.all(
			[
				service.archiveThread({...request, archived: true}),
				service.removeThread(request),
			].map(work =>
				work.then(
					() => 'allowed',
					(error: IpcFailure) => error.code,
				),
			),
		);
	} finally {
		release.resolve();
		await pending;
	}
	t.deepEqual(outcomes, ['BUSY', 'BUSY']);
});

test('an archived thread cannot accept a prompt (CHAT-13)', async t => {
	const {project, service, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	const request = {projectId: project.id, threadId: thread.id};
	await service.archiveThread({...request, archived: true});
	await supervisor.ensureProcess(project);
	let prompts = 0;
	supervisor.getConnection(project.id).prompt = async () => {
		prompts++;
		return {stopReason: 'end_turn'};
	};
	const error = await t.throwsAsync(
		service.promptThread({...request, text: 'fixture prompt'}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
	t.is(prompts, 0);
});

test('trust revoked during session preparation prevents content and execution (CHAT-04, SEC-17)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, store, supervisor} = await fixture(
		t,
		true,
		event => {
			if (event.type === 'turn') events.push(event);
		},
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const original = connection.newSession;
	connection.newSession = async mode => {
		const session = await original(mode);
		store.projects.save({...project, trusted: false});
		return session;
	};
	let prompts = 0;
	connection.prompt = async () => {
		prompts++;
		return {stopReason: 'end_turn'};
	};
	const error = await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture prompt',
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
	t.is(
		store.threads.get(project.id, thread.id)?.nanocoderSessionId,
		'fake-session',
	);
	t.is(prompts, 0);
	t.deepEqual(events, []);
});

test('failed session-ID storage stops the process before content is shown (CHAT-04, DATA-07)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, store, supervisor} = await fixture(
		t,
		true,
		event => {
			if (event.type === 'turn') events.push(event);
		},
	);
	const thread = await service.createThread({projectId: project.id});
	const original = store.threads.save;
	store.threads.save = value => {
		if (value.nanocoderSessionId)
			throw new IpcFailure('INTERNAL', 'Fixture storage failure');
		original(value);
	};
	try {
		const error = await t.throwsAsync(
			service.promptThread({
				projectId: project.id,
				threadId: thread.id,
				text: 'fixture prompt',
			}),
			{instanceOf: IpcFailure},
		);
		t.is((error as IpcFailure).code, 'INTERNAL');
		t.is(supervisor.getState(project.id).status, 'stopped');
		t.is(store.threads.get(project.id, thread.id)?.nanocoderSessionId, null);
		t.deepEqual(events, []);
	} finally {
		store.threads.save = original;
	}
});

test('session ID survives the process ending immediately after session/new without showing content (CHAT-04)', async t => {
	const events: ProjectEvent[] = [];
	const {root, project, service, store, supervisor} = await fixture(
		t,
		true,
		event => {
			if (event.type === 'turn') events.push(event);
		},
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const original = connection.newSession;
	connection.newSession = async mode => {
		const session = await original(mode);
		await supervisor.stop(project.id);
		return session;
	};
	const error = await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture prompt',
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'AGENT_UNAVAILABLE');
	t.is(
		store.threads.get(project.id, thread.id)?.nanocoderSessionId,
		'fake-session',
	);
	store.close();
	const reopened = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	try {
		t.is(
			reopened.threads.get(project.id, thread.id)?.nanocoderSessionId,
			'fake-session',
		);
		t.deepEqual(events, []);
	} finally {
		reopened.close();
	}
});

test('deleting history needs a separate main confirmation and cancellation starts no process (CHAT-14)', async t => {
	const {project, service, store, calls, confirmDeletion} = await fixture(t);
	const thread = seed(project);
	store.threads.save(thread);
	confirmDeletion(async snapshot => {
		t.deepEqual(snapshot, {project, thread});
		return false;
	});
	t.deepEqual(
		await service.deleteThreadHistory({
			projectId: project.id,
			threadId: thread.id,
		}),
		{status: 'cancelled'},
	);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	t.deepEqual(calls, ['confirm-delete']);
});

test('accepted history deletion uses the saved session and removes metadata only after success (CHAT-14, DATA-07)', async t => {
	const {project, service, store, supervisor, confirmDeletion} = await fixture(
		t,
		true,
	);
	const thread = seed(project);
	store.threads.save(thread);
	store.updateUiState({
		activeProjectId: project.id,
		activeThreadId: thread.id,
		openThreadIds: [thread.id],
	});
	confirmDeletion(async () => true);
	await supervisor.ensureProcess(project);
	const deleted: string[] = [];
	supervisor.getConnection(project.id).deleteSession = async sessionId => {
		t.deepEqual(store.threads.get(project.id, thread.id), thread);
		deleted.push(sessionId);
	};
	t.deepEqual(
		await service.deleteThreadHistory({
			projectId: project.id,
			threadId: thread.id,
		}),
		{status: 'deleted'},
	);
	t.deepEqual(deleted, [thread.nanocoderSessionId]);
	t.is(store.threads.get(project.id, thread.id), undefined);
	t.is(store.getUiState().activeThreadId, null);
	t.deepEqual(store.getUiState().openThreadIds, []);
});

test('an upstream history deletion failure preserves the desktop row (CHAT-14)', async t => {
	const {project, service, store, supervisor, confirmDeletion} = await fixture(
		t,
		true,
	);
	const thread = seed(project);
	store.threads.save(thread);
	confirmDeletion(async () => true);
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).deleteSession = async () => {
		throw new NanocoderFailure('AGENT_UNAVAILABLE', 'Fixture delete failed');
	};
	const error = await t.throwsAsync(
		service.deleteThreadHistory({projectId: project.id, threadId: thread.id}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'AGENT_UNAVAILABLE');
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
});

test('history deletion refuses an unadvertised delete capability (CHAT-14)', async t => {
	const {project, service, store, supervisor, confirmDeletion} = await fixture(
		t,
		true,
	);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'no-delete',
	);
	const thread = seed(project);
	store.threads.save(thread);
	confirmDeletion(async () => true);
	const error = await t.throwsAsync(
		service.deleteThreadHistory({projectId: project.id, threadId: thread.id}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'UNSUPPORTED');
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	const connection = supervisor.getConnection(project.id);
	await supervisor.close();
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/delete',
		),
	);
});

test('a history confirmation cannot delete a changed session identity (CHAT-14)', async t => {
	const {project, service, store, calls, confirmDeletion} = await fixture(
		t,
		true,
	);
	const thread = seed(project);
	store.threads.save(thread);
	const changed = {...thread, nanocoderSessionId: 'different-fixture-session'};
	confirmDeletion(async () => {
		store.threads.save(changed);
		return true;
	});
	const error = await t.throwsAsync(
		service.deleteThreadHistory({projectId: project.id, threadId: thread.id}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
	t.deepEqual(store.threads.get(project.id, thread.id), changed);
	t.deepEqual(calls, ['confirm-delete']);
});

test('a pending history confirmation locks its desktop row against removal (CHAT-14)', async t => {
	const {project, service, store, confirmDeletion} = await fixture(t);
	const thread = seed(project);
	store.threads.save(thread);
	const entered = deferred<void>();
	const answer = deferred<boolean>();
	confirmDeletion(async () => {
		entered.resolve();
		return answer.promise;
	});
	const request = {projectId: project.id, threadId: thread.id};
	const deletion = service.deleteThreadHistory(request);
	void deletion.catch(() => undefined);
	const enteredOrError = await Promise.race([
		entered.promise.then(() => 'entered'),
		deletion.then(
			() => 'finished',
			() => 'failed',
		),
	]);
	let removal: string;
	try {
		removal = await service.removeThread(request).then(
			() => 'allowed',
			(error: IpcFailure) => error.code,
		);
	} finally {
		answer.resolve(false);
		await deletion.catch(() => undefined);
	}
	t.is(enteredOrError, 'entered');
	t.is(removal, 'BUSY');
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
});

test('opening a new thread selects its metadata without starting a session (CHAT-03, CHAT-04)', async t => {
	const {project, service, store, calls} = await fixture(t);
	const thread = await service.createThread({projectId: project.id});
	store.updateUiState({activeThreadId: null, openThreadIds: []});
	t.deepEqual(
		await service.openThread({projectId: project.id, threadId: thread.id}),
		{thread, sequence: 0, replaying: false, events: []},
	);
	t.is(store.getUiState().activeThreadId, thread.id);
	t.deepEqual(store.getUiState().openThreadIds, [thread.id]);
	t.deepEqual(calls, []);
});

test('opening a current session reads its in-memory snapshot without resume (CHAT-03)', async t => {
	const {project, service, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	connection.prompt = async () => ({stopReason: 'end_turn'});
	connection.resumeSession = async () => {
		throw new Error('A current session must not resume again');
	};
	const request = {projectId: project.id, threadId: thread.id};
	await service.promptThread({...request, text: 'fixture prompt'});
	const before = await service.getThreadSnapshot(request);
	t.deepEqual(await service.openThread(request), before);
});

test('opening a missing Nanocoder session keeps its ID and shows unable-to-resume reason (CHAT-04 upstream limit)', async t => {
	const {project, service, store} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	const snapshot = await service.openThread({
		projectId: project.id,
		threadId: thread.id,
	});
	t.is(snapshot.thread.id, thread.id);
	t.is(snapshot.thread.nanocoderSessionId, thread.nanocoderSessionId);
	t.is(snapshot.thread.title, thread.title);
	t.is(snapshot.thread.runState, 'view-only');
	t.regex(
		snapshot.thread.viewOnlyReason ?? '',
		/Nanocoder has no saved history/,
	);
	t.deepEqual(snapshot.events, []);
	t.deepEqual(store.threads.get(project.id, thread.id), snapshot.thread);
});

test('opening a stored session delegates replay and never restores yolo (CHAT-04, DEC-31)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, store, supervisor} = await fixture(
		t,
		true,
		event => {
			if (event.type === 'turn') events.push(event);
		},
	);
	const thread = seed(project, {
		nanocoderSessionId: 'fake-session',
		mode: 'yolo',
	});
	store.threads.save(thread);
	const snapshot = await service.openThread({
		projectId: project.id,
		threadId: thread.id,
	});
	t.is(snapshot.thread.nanocoderSessionId, 'fake-session');
	t.is(snapshot.thread.runState, 'ready');
	t.is(snapshot.thread.mode, 'auto-accept');
	t.deepEqual(snapshot.events, [
		{type: 'user', text: 'Earlier question'},
		{type: 'text', text: 'Earlier answer'},
		{
			type: 'tool',
			id: 'old_call',
			title: 'execute_bash: echo old',
			status: 'completed',
		},
	]);
	t.deepEqual(events, []);
	const connection = supervisor.getConnection(project.id);
	await supervisor.close();
	const modes = fakeEvents(connection.stderr.lines())
		.filter(event => event.method === 'session/set_mode')
		.map(event => (event.params as {modeId: string}).modeId);
	t.deepEqual(modes, ['auto-accept']);
});

test('creating a thread keeps the persisted open-tab list bounded (CHAT-03)', async t => {
	const {project, service, store} = await fixture(t);
	const previous = Array.from({length: 100}, () => seed(project));
	for (const thread of previous) store.threads.save(thread);
	store.updateUiState({
		activeProjectId: project.id,
		activeThreadId: previous[0].id,
		openThreadIds: previous.map(thread => thread.id),
	});
	const thread = await service.createThread({projectId: project.id});
	t.deepEqual(store.getUiState().openThreadIds, [
		...previous.slice(1).map(thread => thread.id),
		thread.id,
	]);
	t.is(store.getUiState().activeThreadId, thread.id);
});

test('an unable-to-resume thread refuses prompts without showing new content (CHAT-04 upstream limit)', async t => {
	const events: ProjectEvent[] = [];
	const {project, service, store, calls} = await fixture(t, true, event => {
		if (event.type === 'turn') events.push(event);
	});
	const thread = seed(project, {
		runState: 'view-only',
		viewOnlyReason: 'Fixture history is not available',
	});
	store.threads.save(thread);
	const error = await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'fixture prompt',
		}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'UNAVAILABLE');
	t.deepEqual(events, []);
	t.deepEqual(calls, []);
});
