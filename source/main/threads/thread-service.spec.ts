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
	type NanocoderConnection,
	NanocoderFailure,
	type NanocoderTurnResult,
} from '@/main/nanocoder/acp-client';
import {FakeClock} from '@/main/nanocoder/fixtures/fake-clock';
import {fakeEvents, fakeRuntime} from '@/main/nanocoder/fixtures/fake-project';
import {connectProject} from '@/main/nanocoder/open-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {desktopStoreFactory} from '@/main/store';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import {createThreadService} from '@/main/threads/thread-service';
import type {
	PermissionRequestInfo,
	ProjectEvent,
	ProjectInfo,
	ThreadInfo,
	TurnEvent,
} from '@/shared/ipc';

async function fixture(
	t: ExecutionContext,
	enableRuntime = false,
	onEvent?: (event: ProjectEvent) => void,
	withLifecycle = false,
) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-threads-')),
	);
	const store = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	const calls: string[] = [];
	const connections: NanocoderConnection[] = [];
	const clock = new FakeClock();
	let service!: ReturnType<typeof createThreadService>;
	const projectRoot = path.join(root, 'project');
	mkdirSync(projectRoot);
	let update: ConnectOptions['onSessionUpdate'];
	let titleUpdate: ConnectOptions['onTitleChanged'];
	let confirm: NonNullable<
		Parameters<typeof createThreadService>[0]['confirmDeleteHistory']
	> = async () => false;
	const supervisor = new ProjectSupervisor({
		clock: withLifecycle ? clock : undefined,
		activity: withLifecycle ? id => service.activity(id) : undefined,
		recover: withLifecycle
			? (chosen, connection, signal) =>
					service.restore(chosen, connection, signal)
			: undefined,
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
		connect: async options => {
			update = options.onSessionUpdate;
			titleUpdate = options.onTitleChanged;
			const connection = await connectProject(options);
			if (!('status' in connection)) connections.push(connection);
			return connection;
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
	service = createThreadService({
		store,
		supervisor,
		clock,
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
		connections,
		project,
		supervisor,
		service,
		clock,
		confirmDeletion: (callback: typeof confirm) => {
			confirm = callback;
		},
		notifyTitle: (sessionId: string, title: string) => {
			if (!titleUpdate) throw new Error('No fixture connection is ready');
			titleUpdate({sessionId, title});
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

function nextFailure(supervisor: ProjectSupervisor) {
	const failed = deferred<void>();
	const off = supervisor.subscribe(event => {
		if (event.type === 'supervisor' && event.state.status === 'failed') {
			off();
			failed.resolve();
		}
	});
	return failed.promise;
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

async function waitingThread(t: ExecutionContext, two = false) {
	const waiting = deferred<PermissionRequestInfo[]>();
	const requests: PermissionRequestInfo[] = [];
	const context = await fixture(t, true, event => {
		if (event.type !== 'turn') return;
		for (const item of event.events) {
			if (item.type !== 'permission') continue;
			requests.push(item.request);
			if (requests.length === (two ? 2 : 1)) waiting.resolve(requests);
		}
	});
	if (two)
		writeFileSync(
			path.join(context.project.canonicalRoot, '.fake-nanocoder'),
			'two-tools',
		);
	const metadata: ThreadInfo[] = [];
	context.supervisor.subscribe(event => {
		if (event.type === 'thread') metadata.push(event.thread);
	});
	const thread = await context.service.createThread({
		projectId: context.project.id,
	});
	const target = {projectId: context.project.id, threadId: thread.id};
	const turn = context.service.promptThread({
		...target,
		text: 'fixture request',
	});
	void turn.catch(() => undefined);
	t.teardown(async () => {
		await context.supervisor
			.cancel(context.project.id, 'fake-session')
			.catch(() => undefined);
		await turn.catch(() => undefined);
	});
	return {
		...context,
		thread,
		target,
		turn,
		requests: await waiting.promise,
		connection: context.supervisor.getConnection(context.project.id),
		metadata,
	};
}

for (const mode of [
	'resume-fails',
	'mode-fails',
	'no-normal',
	'missing-session',
	'no-resume',
]) {
	test(`cached ${mode} keeps its thread identity and refuses prompts until explicit same-history retry, never a fresh session (CHAT-04, ACP-13)`, async t => {
		const {project, store, service, supervisor} = await fixture(t, true);
		const thread = seed(project, {nanocoderSessionId: 'fake-session'});
		const other = seed(project, {nanocoderSessionId: null});
		store.threads.save(thread);
		store.threads.save(other);
		const request = {projectId: project.id, threadId: thread.id};
		const before = await service.openThread(request);
		await supervisor.stop(project.id);
		writeFileSync(path.join(project.canonicalRoot, '.fake-nanocoder'), mode);
		const unavailable = await service.openThread(request);
		t.is(unavailable.thread.runState, 'view-only');
		t.truthy(unavailable.thread.viewOnlyReason);
		if (mode === 'resume-fails')
			t.is(
				unavailable.thread.viewOnlyReason,
				'Nanocoder could not resume the session',
			);
		if (mode === 'mode-fails')
			t.is(
				unavailable.thread.viewOnlyReason,
				'Nanocoder did not set the normal mode',
			);
		if (mode === 'no-normal')
			t.is(
				unavailable.thread.viewOnlyReason,
				'Nanocoder does not offer the normal mode',
			);
		if (mode === 'no-resume')
			t.is(
				unavailable.thread.viewOnlyReason,
				'This version of Nanocoder cannot resume sessions',
			);
		t.is(unavailable.thread.id, thread.id);
		t.is(unavailable.thread.nanocoderSessionId, thread.nanocoderSessionId);
		t.deepEqual(unavailable.events, before.events);
		t.deepEqual(store.threads.get(project.id, other.id), other);
		t.is(supervisor.getState(project.id).status, 'ready');
		const connection = supervisor.getConnection(project.id);
		await t.throwsAsync(service.promptThread({...request, text: 'refused'}), {
			instanceOf: IpcFailure,
		});
		const methods = fakeEvents(connection.stderr.lines()).map(
			event => event.method,
		);
		t.false(methods.includes('session/new'));
		t.false(methods.includes('session/prompt'));
		t.is(methods.includes('session/resume'), mode !== 'no-resume');
		if (mode !== 'missing-session')
			t.notRegex(unavailable.thread.viewOnlyReason ?? '', /no saved history/);
		await supervisor.stop(project.id);
		writeFileSync(path.join(project.canonicalRoot, '.fake-nanocoder'), 'ok');
		const reopened = await service.openThread(request);
		t.is(reopened.thread.runState, 'ready');
		t.is(reopened.thread.viewOnlyReason, null);
		t.is(reopened.thread.nanocoderSessionId, thread.nanocoderSessionId);
		const fresh = supervisor.getConnection(project.id);
		t.not(fresh, connection);
		t.deepEqual(
			fakeEvents(fresh.stderr.lines())
				.map(event => event.method)
				.filter(
					method => typeof method === 'string' && method.startsWith('session/'),
				),
			['session/resume', 'session/set_mode'],
		);
		const permission = deferred<PermissionRequestInfo>();
		const off = supervisor.subscribe(event => {
			if (event.type === 'turn')
				for (const item of event.events)
					if (item.type === 'permission') permission.resolve(item.request);
		});
		const turn = service.promptThread({...request, text: 'explicit retry'});
		const offered = await permission.promise;
		await service.answerThreadPermission({
			...request,
			requestId: offered.id,
			optionId: 'deny',
		});
		t.deepEqual(await turn, {stopReason: 'end_turn'});
		off();
		t.is(
			store.threads.get(project.id, thread.id)?.nanocoderSessionId,
			thread.nanocoderSessionId,
		);
		t.false(
			fakeEvents(fresh.stderr.lines()).some(
				event => event.method === 'session/new',
			),
		);
	});
}

for (const mode of [
	'no-resume',
	'missing-session',
	'resume-fails',
	'mode-fails',
	'no-normal',
]) {
	test(`${mode} automatic thread recovery stays unavailable without replacement history or re-prompt (ACP-13, CHAT-04)`, async t => {
		const {project, service, store, supervisor, clock, connections} =
			await fixture(t, true, undefined, true);
		const thread = await service.createThread({projectId: project.id});
		store.threads.save({...thread, mode: 'normal'});
		const failed = nextFailure(supervisor);
		writeFileSync(
			path.join(project.canonicalRoot, '.fake-nanocoder'),
			'die-in-turn',
		);
		await t.throwsAsync(
			service.promptThread({
				projectId: project.id,
				threadId: thread.id,
				text: 'synthetic failure',
			}),
		);
		await failed;
		writeFileSync(path.join(project.canonicalRoot, '.fake-nanocoder'), mode);
		const unavailable = deferred<void>();
		const off = supervisor.subscribe(event => {
			if (
				event.type === 'supervisor' &&
				['failed', 'unsupported'].includes(event.state.status) &&
				event.state.restart.nextAttemptAt === null
			)
				unavailable.resolve();
		});
		clock.advance(1000);
		await unavailable.promise;
		off();
		t.throws(() => supervisor.getConnection(project.id));
		t.is(clock.pending, 0);
		const connection = connections.at(-1);
		if (!connection) throw new Error('Missing recovered connection');
		const methods = fakeEvents(connection.stderr.lines()).map(
			event => event.method,
		);
		t.false(methods.includes('session/new'));
		t.false(methods.includes('session/prompt'));
		t.is(methods.includes('session/resume'), mode !== 'no-resume');
		t.is(
			store.threads.get(project.id, thread.id)?.nanocoderSessionId,
			'fake-session',
		);
	});
}

test('detaching a failed thread cancels its pending recovery without a later launch (ACP-13)', async t => {
	const {project, service, supervisor, clock, calls} = await fixture(
		t,
		true,
		undefined,
		true,
	);
	const thread = await service.createThread({projectId: project.id});
	const failed = nextFailure(supervisor);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'die-in-turn',
	);
	await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'synthetic failure',
		}),
	);
	await failed;
	t.not(supervisor.getState(project.id).restart.nextAttemptAt, null);
	await service.detach([project]);
	t.is(clock.pending, 0);
	clock.advance(60_000);
	t.is(supervisor.getState(project.id).status, 'stopped');
	t.is(calls.filter(call => call === 'launch').length, 1);
});

test('thread recovery remains starting through slow mode confirmation and detach settles the child without replaying content (ACP-13)', async t => {
	const mapped: ProjectEvent[] = [];
	const {project, service, supervisor, clock, connections} = await fixture(
		t,
		true,
		event => mapped.push(event),
		true,
	);
	const thread = await service.createThread({projectId: project.id});
	const failed = nextFailure(supervisor);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'die-in-turn',
	);
	await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'synthetic failure',
		}),
	);
	await failed;
	const before = mapped.length;
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'slow-mode',
	);
	const waiting = deferred<void>();
	const off = supervisor.subscribe(event => {
		if (
			event.type === 'turn' &&
			event.events.some(
				item => item.type === 'text' && item.text === 'mode waiting',
			)
		)
			waiting.resolve();
	});
	clock.advance(1000);
	await waiting.promise;
	off();
	t.is(supervisor.getState(project.id).status, 'starting');
	t.throws(() => supervisor.getConnection(project.id));
	t.true(service.activity(project.id).preparing);
	await service.detach([project]);
	t.is(supervisor.getState(project.id).status, 'stopped');
	t.is(clock.pending, 0);
	const connection = connections.at(-1);
	if (!connection) throw new Error('Missing recovered connection');
	await connection.exited;
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event =>
				event.method === 'session/new' || event.method === 'session/prompt',
		),
	);
	t.deepEqual(
		mapped.slice(before).filter(event => event.type === 'turn'),
		[],
	);
	t.false(service.activity(project.id).preparing);
});

test('a mode result from a replaced connection cannot commit readiness or content, and explicit reopen resumes its saved identity (ACP-13, CHAT-04)', async t => {
	const {project, service, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const original = connection.newSession;
	const entered = deferred<void>();
	const release = deferred<void>();
	t.teardown(() => release.resolve());
	connection.newSession = async mode => {
		const result = await original(mode);
		entered.resolve();
		await release.promise;
		return result;
	};
	const request = {projectId: project.id, threadId: thread.id};
	const turn = service.promptThread({...request, text: 'never published'});
	const rejected = t.throwsAsync(turn, {code: 'AGENT_UNAVAILABLE'});
	await entered.promise;
	await supervisor.stop(project.id);
	await supervisor.ensureProcess(project);
	release.resolve();
	await rejected;
	const snapshot = await service.getThreadSnapshot(request);
	t.is(snapshot.thread.runState, 'new');
	t.is(snapshot.thread.nanocoderSessionId, 'fake-session');
	t.deepEqual(snapshot.events, []);
	t.false(service.activity(project.id).preparing);
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/prompt',
		),
	);
	const reopened = await service.openThread(request);
	t.is(reopened.thread.runState, 'ready');
	t.is(reopened.thread.nanocoderSessionId, 'fake-session');
	t.deepEqual(
		fakeEvents(supervisor.getConnection(project.id).stderr.lines())
			.map(event => event.method)
			.filter(
				method => typeof method === 'string' && method.startsWith('session/'),
			),
		['session/resume', 'session/set_mode'],
	);
});

test('thread cancellation waits for the exact owning supervisor settlement before replying (ACP-10)', async t => {
	const {service, supervisor, target, turn} = await waitingThread(t);
	const original = supervisor.cancel.bind(supervisor);
	const entered = deferred<void>();
	const release = deferred<void>();
	t.teardown(() => {
		release.resolve();
		supervisor.cancel = original;
	});
	supervisor.cancel = async (...args) => {
		await original(...args);
		entered.resolve();
		await release.promise;
	};
	let settled = false;
	const cancellation = service.cancelThread(target).then(result => {
		settled = true;
		return result;
	});
	await entered.promise;
	t.false(settled);
	release.resolve();
	t.is(await cancellation, null);
	t.deepEqual(await turn, {stopReason: 'cancelled'});
});

test('signal exit settles the thread activity and revokes its pending approval (ACP-13, ACP-10)', async t => {
	const {project, service, supervisor, connection, target, requests, turn} =
		await waitingThread(t);
	t.true(service.activity(project.id).runningTurn);
	const started = fakeEvents(connection.stderr.lines()).find(
		event => event.started,
	);
	if (typeof started?.pid !== 'number') throw new Error('Missing fake child');
	const failed = deferred<void>();
	const off = supervisor.subscribe(event => {
		if (event.type === 'supervisor' && event.state.status === 'failed')
			failed.resolve();
	});
	const rejected = t.throwsAsync(turn);
	process.kill(started.pid, 'SIGTERM');
	await failed.promise;
	await rejected;
	off();
	t.deepEqual(supervisor.getState(project.id).exit, {
		code: null,
		signal: 'SIGTERM',
	});
	t.false(service.activity(project.id).runningTurn);
	await t.throwsAsync(
		service.answerThreadPermission({
			...target,
			requestId: requests[0].id,
			optionId: 'allow',
		}),
	);
});

test('ordinary history open refuses a located root before launch or former-cwd resume and keeps its saved identity (CHAT-01, CHAT-04)', async t => {
	const {project, service, store, supervisor, root, calls} = await fixture(
		t,
		true,
	);
	const thread = seed(project, {nanocoderSessionId: 'fake-session'});
	store.threads.save(thread);
	const request = {projectId: project.id, threadId: thread.id};
	const before = await service.openThread(request);
	await supervisor.stop(project.id);
	const located = path.join(root, 'located');
	mkdirSync(located);
	store.projects.save({
		...project,
		canonicalRoot: located,
		sessionCwd: located,
		trusted: true,
	});
	await t.throwsAsync(service.openThread(request), {
		instanceOf: IpcFailure,
		code: 'DENIED',
	});
	t.deepEqual(await service.getThreadSnapshot(request), before);
	t.is(calls.filter(call => call === 'launch').length, 1);
	t.is(supervisor.getState(project.id).status, 'stopped');
});

test('a restarted waiting thread is interrupted with no synthetic terminal, launch or surviving approval authority (CHAT-03, ACP-10)', async t => {
	const {project, root, service, store, supervisor, target, requests, turn} =
		await waitingThread(t);
	const waiting = store.threads.get(project.id, target.threadId);
	if (!waiting) throw new Error('Missing waiting fixture thread');
	t.is(waiting.runState, 'waiting-approval');
	await service.detach([project]);
	await turn;
	service.dispose();
	store.threads.save(waiting);
	store.close();
	const reopened = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	let launches = 0;
	const fresh = new ProjectSupervisor({
		resolveRuntime: async () => {
			launches++;
			throw new Error('Restart metadata must not launch');
		},
		clientInfo: {name: 'restart-fixture', version: '0.0.0'},
		confirmTrust: async () => false,
	});
	const mapped: ProjectEvent[] = [];
	const restarted = createThreadService({
		store: reopened,
		supervisor: fresh,
		onEvent: event => mapped.push(event),
	});
	t.teardown(async () => {
		restarted.dispose();
		await fresh.close();
		reopened.close();
	});
	t.is(
		reopened.threads.get(project.id, target.threadId)?.runState,
		'interrupted',
	);
	t.deepEqual(await restarted.getThreadSnapshot(target), {
		thread: {...waiting, runState: 'interrupted'},
		sequence: 0,
		events: [],
		replaying: false,
	});
	await t.throwsAsync(
		restarted.answerThreadPermission({
			...target,
			requestId: requests[0].id,
			optionId: 'allow',
		}),
		{instanceOf: IpcFailure, code: 'DENIED'},
	);
	t.false(
		fresh.answerPermission(
			project.id,
			waiting.nanocoderSessionId ?? '',
			requests[0].id,
			'allow',
		),
	);
	t.is(fresh.getState(project.id).activeThreadId, null);
	t.is(launches, 0);
	t.deepEqual(mapped, []);
	t.false(
		supervisor.answerPermission(
			project.id,
			waiting.nanocoderSessionId ?? '',
			requests[0].id,
			'allow',
		),
	);
});

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

test('thread lifecycle attachment reports activity without creating or resuming any session (CHAT-03, ACP-13)', async t => {
	const {service, project, calls, clock} = await fixture(t);
	t.deepEqual(service.activity(project.id), {
		runningTurn: false,
		openSessions: 0,
		preparing: false,
		lastActivityAt: 0,
	});
	clock.advance(12);
	service.attachProject(project.id);
	t.deepEqual(service.activity(project.id), {
		runningTurn: false,
		openSessions: 1,
		preparing: false,
		lastActivityAt: clock.now(),
	});
	t.deepEqual(calls, []);
});

test('thread recovery uses the supplied starting connection and replaces its mapped snapshot without raw replay or re-prompting (ACP-13, CHAT-04)', async t => {
	const mapped: ProjectEvent[] = [];
	const {service, project, store, supervisor, clock} = await fixture(
		t,
		true,
		event => mapped.push(event),
		true,
	);
	const thread = await service.createThread({projectId: project.id});
	store.threads.save({...thread, mode: 'normal'});
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'die-in-turn',
	);
	let failed!: () => void;
	const failure = new Promise<void>(resolve => {
		failed = resolve;
	});
	supervisor.subscribe(event => {
		if (event.type === 'supervisor' && event.state.status === 'failed')
			failed();
	});
	await t.throwsAsync(
		service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'synthetic failure',
		}),
	);
	await failure;
	const before = await service.getThreadSnapshot({
		projectId: project.id,
		threadId: thread.id,
	});
	t.false(before.result?.ok);
	const raw: ProjectEvent[] = [];
	let ready!: () => void;
	const recovered = new Promise<void>(resolve => {
		ready = resolve;
	});
	const off = supervisor.subscribe(event => {
		if (event.type === 'turn') raw.push(event);
		if (event.type === 'supervisor' && event.state.status === 'ready') ready();
	});
	clock.advance(1000);
	await recovered;
	off();
	const snapshot = await service.getThreadSnapshot({
		projectId: project.id,
		threadId: thread.id,
	});
	t.is(snapshot.thread.runState, 'ready');
	t.is(snapshot.result, undefined);
	t.is(snapshot.thread.mode, 'normal');
	t.is(snapshot.thread.nanocoderSessionId, 'fake-session');
	t.is(snapshot.sequence, before.sequence + 1);
	t.true(
		snapshot.events.some(
			event => event.type === 'user' && event.text === 'Earlier question',
		),
	);
	t.deepEqual(raw, []);
	const requests = fakeEvents(
		supervisor.getConnection(project.id).stderr.lines(),
	).filter(
		event =>
			typeof event.method === 'string' && event.method.startsWith('session/'),
	);
	t.deepEqual(
		requests.map(event => event.method),
		['session/resume', 'session/set_mode'],
	);
	t.false(
		mapped.some(
			event => event.type === 'turn' && event.threadId === 'fake-session',
		),
	);
});

test('thread detach cancels running and starting projects while preserving idle processes (ACP-13, ACP-10)', async t => {
	const {root, service, supervisor, store, project, turn, connection} =
		await waitingThread(t);
	const peers = ['idle', 'starting'].map(name => {
		const folder = path.join(root, name);
		mkdirSync(folder);
		const chosen = {
			...project,
			id: randomUUID(),
			canonicalRoot: folder,
			sessionCwd: folder,
		};
		store.projects.save(chosen);
		return chosen;
	});
	await supervisor.ensureProcess(peers[0]);
	const starting = supervisor.ensureProcess(peers[1]);
	await service.detach([project, ...peers]);
	t.is(supervisor.getState(project.id).status, 'stopped');
	t.is(supervisor.getState(peers[0].id).status, 'ready');
	await starting;
	t.is(supervisor.getState(peers[1].id).status, 'stopped');
	t.deepEqual(await turn, {stopReason: 'cancelled'});
	t.is(service.activity(project.id).openSessions, 0);
	await connection.exited;
	t.deepEqual(
		fakeEvents(connection.stderr.lines())
			.filter(event => 'answer' in event)
			.map(event => event.answer),
		[{outcome: 'cancelled'}],
	);
});

for (const [mode, resume] of [
	['slow-new', false],
	['slow-mode', false],
	['slow-resume', true],
	['slow-mode', true],
] as const) {
	test(`thread detach owns ${mode} ${resume ? 'resume' : 'new'} preparation before any prompt (ACP-13, CHAT-04)`, async t => {
		const {service, supervisor, store, project} = await fixture(t, true);
		writeFileSync(path.join(project.canonicalRoot, '.fake-nanocoder'), mode);
		const thread = resume
			? seed(project, {nanocoderSessionId: 'fake-session'})
			: await service.createThread({projectId: project.id});
		if (resume) store.threads.save(thread);
		await supervisor.ensureProcess(project);
		const connection = supervisor.getConnection(project.id);
		const waiting = deferred<void>();
		const off = supervisor.subscribe(event => {
			if (
				event.type === 'turn' &&
				event.events.some(
					item => item.type === 'text' && item.text.includes('waiting'),
				)
			)
				waiting.resolve();
		});
		if (mode === 'slow-resume') {
			const original = connection.resumeSession;
			connection.resumeSession = (...args) => {
				const pending = original(...args);
				waiting.resolve();
				return pending;
			};
		}
		const preparing = service.promptThread({
			projectId: project.id,
			threadId: thread.id,
			text: 'never sent',
		});
		const rejected = t.throwsAsync(preparing);
		await waiting.promise;
		t.true(service.activity(project.id).preparing);
		await service.detach([]);
		t.is(supervisor.getState(project.id).status, 'stopped');
		await rejected;
		off();
		await connection.exited;
		t.false(
			fakeEvents(connection.stderr.lines()).some(
				event => event.method === 'session/prompt',
			),
		);
		t.false(service.activity(project.id).preparing);
	});
}

for (const [mode, resume] of [
	['slow-new', false],
	['slow-mode', false],
	['slow-resume', true],
	['slow-mode', true],
] as const) {
	test(`thread cancel stops ${mode} ${resume ? 'resume' : 'new'} preparation before any prompt (CHAT-06, ACP-10)`, async t => {
		const {service, supervisor, store, project} = await fixture(t, true);
		writeFileSync(path.join(project.canonicalRoot, '.fake-nanocoder'), mode);
		const thread = resume
			? seed(project, {nanocoderSessionId: 'fake-session'})
			: await service.createThread({projectId: project.id});
		if (resume) store.threads.save(thread);
		await supervisor.ensureProcess(project);
		const connection = supervisor.getConnection(project.id);
		const waiting = deferred<void>();
		const off = supervisor.subscribe(event => {
			if (
				event.type === 'turn' &&
				event.events.some(
					item => item.type === 'text' && item.text.includes('waiting'),
				)
			)
				waiting.resolve();
		});
		if (mode === 'slow-resume') {
			const original = connection.resumeSession;
			connection.resumeSession = (...args) => {
				const pending = original(...args);
				waiting.resolve();
				return pending;
			};
		}
		const request = {projectId: project.id, threadId: thread.id};
		const turn = service.promptThread({...request, text: 'never sent'});
		void turn.catch(() => undefined);
		await waiting.promise;
		const peer = await service.createThread({projectId: project.id});
		t.is(
			await service.cancelThread({projectId: project.id, threadId: peer.id}),
			null,
		);
		t.is(supervisor.getState(project.id).status, 'ready');
		t.true(service.activity(project.id).preparing);
		t.is(await service.cancelThread(request), null);
		t.is(supervisor.getState(project.id).status, 'stopped');
		t.deepEqual(await turn, {stopReason: 'cancelled'});
		off();
		const snapshot = await service.getThreadSnapshot(request);
		t.is(snapshot.thread.runState, 'interrupted');
		t.deepEqual(snapshot.events, []);
		if (!resume) t.is(snapshot.thread.nanocoderSessionId, null);
		t.false(
			fakeEvents(connection.stderr.lines()).some(
				event => event.method === 'session/prompt',
			),
		);
	});
}

test('cancelling an already-settled turn cannot mistake pending cleanup for session preparation (CHAT-06)', async t => {
	const {service, supervisor, project} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	const request = {projectId: project.id, threadId: thread.id};
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).prompt = async () => ({
		stopReason: 'end_turn',
	});
	let working = false;
	let cancelled: Promise<null> | undefined;
	const off = supervisor.subscribe(event => {
		if (event.type !== 'supervisor' || event.state.status !== 'ready') return;
		if (event.state.activeThreadId) working = true;
		else if (working && !cancelled) cancelled = service.cancelThread(request);
	});
	t.deepEqual(await service.promptThread({...request, text: 'finished'}), {
		stopReason: 'end_turn',
	});
	t.truthy(cancelled);
	await cancelled;
	off();
	t.is(supervisor.getState(project.id).status, 'ready');
	t.is((await service.getThreadSnapshot(request)).thread.runState, 'ready');
});

for (const action of ['cancel', 'detach'] as const) {
	for (const resume of [false, true]) {
		test(`a late ${resume ? 'resumed' : 'new'} mode result after ${action} cannot commit session preparation or user content (ACP-10, ACP-13)`, async t => {
			const {service, store, supervisor, project} = await fixture(t, true);
			const thread = resume
				? seed(project, {nanocoderSessionId: 'fake-session'})
				: await service.createThread({projectId: project.id});
			if (resume) store.threads.save(thread);
			await supervisor.ensureProcess(project);
			const connection = supervisor.getConnection(project.id);
			const entered = deferred<void>();
			const release = deferred<void>();
			t.teardown(() => release.resolve());
			if (resume) {
				const original = connection.resumeSession;
				connection.resumeSession = async (...args) => {
					const value = await original(...args);
					entered.resolve();
					await release.promise;
					return value;
				};
			} else {
				const original = connection.newSession;
				connection.newSession = async (...args) => {
					const value = await original(...args);
					entered.resolve();
					await release.promise;
					return value;
				};
			}
			const request = {projectId: project.id, threadId: thread.id};
			const turn = service.promptThread({...request, text: 'never published'});
			void turn.catch(() => undefined);
			const rejected =
				action === 'detach'
					? t.throwsAsync(turn, {code: 'AGENT_UNAVAILABLE'})
					: undefined;
			await entered.promise;
			const stopped =
				action === 'detach'
					? service.detach([])
					: service.cancelThread(request);
			release.resolve();
			await stopped;
			if (rejected) await rejected;
			else t.deepEqual(await turn, {stopReason: 'cancelled'});
			const snapshot = await service.getThreadSnapshot(request);
			t.is(snapshot.thread.nanocoderSessionId, resume ? 'fake-session' : null);
			t.deepEqual(snapshot.events, []);
			t.false(
				fakeEvents(connection.stderr.lines()).some(
					event => event.method === 'session/prompt',
				),
			);
		});
	}
}

for (const outcome of ['completed', 'cancelled', 'failed'] as const) {
	test(`a ${outcome} result is sequenced in the owning transient snapshot only and clears before the next accepted user turn (CHAT-03, DATA-07)`, async t => {
		const mapped: ProjectEvent[] = [];
		const {service, supervisor, project, store} = await fixture(
			t,
			true,
			event => mapped.push(event),
		);
		const thread = await service.createThread({projectId: project.id});
		const request = {projectId: project.id, threadId: thread.id};
		await supervisor.ensureProcess(project);
		const connection = supervisor.getConnection(project.id);
		connection.prompt = async () => {
			if (outcome === 'failed')
				throw new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					'safe terminal failure',
				);
			return {stopReason: outcome === 'cancelled' ? 'cancelled' : 'end_turn'};
		};
		const prompting = service.promptThread({
			...request,
			text: 'synthetic turn',
		});
		if (outcome === 'failed')
			await t.throwsAsync(prompting, {
				code: 'AGENT_UNAVAILABLE',
				message: 'safe terminal failure',
			});
		else await prompting;
		const result =
			outcome === 'failed'
				? {
						ok: false,
						error: {
							code: 'AGENT_UNAVAILABLE',
							message: 'safe terminal failure',
							retryable: false,
						},
					}
				: {
						ok: true,
						value: {
							stopReason: outcome === 'cancelled' ? 'cancelled' : 'end_turn',
						},
					};
		const snapshot = await service.getThreadSnapshot(request);
		t.deepEqual(snapshot.result, result);
		const terminal = mapped.filter(event => event.type === 'turn').at(-1);
		t.deepEqual(terminal?.result, result);
		t.is(terminal?.sequence, snapshot.sequence);
		t.false(
			JSON.stringify(store.threads.get(project.id, thread.id)).includes(
				'stopReason',
			),
		);
		t.false(
			JSON.stringify(store.threads.get(project.id, thread.id)).includes(
				'safe terminal failure',
			),
		);
		const entered = deferred<void>();
		const response = deferred<NanocoderTurnResult>();
		connection.prompt = async () => {
			entered.resolve();
			return response.promise;
		};
		const next = service.promptThread({...request, text: 'next accepted turn'});
		await entered.promise;
		t.is((await service.getThreadSnapshot(request)).result, undefined);
		response.resolve({stopReason: 'end_turn'});
		await next;
	});
}

test('terminal failures use the same safe IPC failure without raw details and every returned result is cloned (DATA-07, ACP-13)', async t => {
	const mapped: ProjectEvent[] = [];
	const {service, supervisor, project, store} = await fixture(t, true, event =>
		mapped.push(event),
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).prompt = async () => {
		throw new Error('synthetic-raw-acp-body-not-for-renderer');
	};
	const request = {projectId: project.id, threadId: thread.id};
	const failure = await t.throwsAsync(
		service.promptThread({...request, text: 'synthetic accepted prompt'}),
		{
			instanceOf: IpcFailure,
			code: 'AGENT_UNAVAILABLE',
			message: 'The thread request could not finish',
		},
	);
	const expected = {
		ok: false,
		error: {
			code: failure?.code,
			message: failure?.message,
			retryable: false,
		},
	};
	const snapshot = await service.getThreadSnapshot(request);
	const terminal = mapped.filter(event => event.type === 'turn').at(-1);
	t.deepEqual(snapshot.result, expected);
	t.deepEqual(terminal?.result, expected);
	t.false(JSON.stringify(snapshot).includes('synthetic-raw-acp-body'));
	t.false(
		JSON.stringify(store.threads.get(project.id, thread.id)).includes(
			'stopReason',
		),
	);
	if (snapshot.result && !snapshot.result.ok)
		snapshot.result.error.message = 'changed snapshot';
	if (terminal?.result && !terminal.result.ok)
		terminal.result.error.message = 'changed event';
	t.deepEqual((await service.getThreadSnapshot(request)).result, expected);
});

test('resolved turn metadata uses only its owning desktop sequence and never the IPC result or metadata store (CHAT-19, DATA-07)', async t => {
	const events: ProjectEvent[] = [];
	const {service, supervisor, project, store} = await fixture(t, true, event =>
		events.push(event),
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const response = deferred<NanocoderTurnResult>();
	const entered = deferred<void>();
	supervisor.getConnection(project.id).prompt = async () => {
		entered.resolve();
		return response.promise;
	};
	const request = {projectId: project.id, threadId: thread.id};
	const turn = service.promptThread({...request, text: 'first'});
	await entered.promise;
	const peer = await service.createThread({projectId: project.id});
	const metadata = {
		usage: {totalTokens: 20},
		artifacts: [{kind: 'task' as const, path: 'transient-metadata-only.txt'}],
	};
	response.resolve({stopReason: 'end_turn', metadata});
	t.deepEqual(await turn, {stopReason: 'end_turn'});
	const mapped = events.filter(event => event.type === 'turn');
	t.deepEqual(
		mapped.map(event => ({
			threadId: event.threadId,
			sequence: event.sequence,
			events: event.events,
		})),
		[
			{
				threadId: thread.id,
				sequence: 1,
				events: [{type: 'user', text: 'first'}],
			},
			{
				threadId: thread.id,
				sequence: 2,
				events: [{type: 'metadata', metadata}],
			},
			{threadId: thread.id, sequence: 3, events: []},
		],
	);
	t.deepEqual(
		(
			await service.getThreadSnapshot({
				projectId: project.id,
				threadId: peer.id,
			})
		).events,
		[],
	);
	t.false(
		JSON.stringify(store.threads.list(project.id, 'active')).includes(
			'transient-metadata-only.txt',
		),
	);
	metadata.usage.totalTokens = 999;
	t.is(
		(await service.getThreadSnapshot(request)).events.at(-1)?.metadata?.usage
			?.totalTokens,
		20,
	);
});

for (const changed of ['session', 'root', 'cwd']) {
	test(`resolved metadata cannot enter a replacement ${changed} owner or overwrite its state (CHAT-19, ACP-13)`, async t => {
		const events: ProjectEvent[] = [];
		const {service, supervisor, store, project} = await fixture(
			t,
			true,
			event => events.push(event),
		);
		const thread = await service.createThread({projectId: project.id});
		await supervisor.ensureProcess(project);
		const entered = deferred<void>();
		const response = deferred<NanocoderTurnResult>();
		supervisor.getConnection(project.id).prompt = async () => {
			entered.resolve();
			return response.promise;
		};
		const request = {projectId: project.id, threadId: thread.id};
		const turn = service.promptThread({...request, text: 'old owner'});
		const refused = t.throwsAsync(turn, {code: 'AGENT_UNAVAILABLE'});
		await entered.promise;
		const current = {
			...(await service.getThreadSnapshot(request)).thread,
			runState: 'ready' as const,
			lastActivityAt: '2020-01-01T00:00:00.000Z',
		};
		const replacement = path.join(project.canonicalRoot, 'replacement');
		mkdirSync(replacement);
		if (changed === 'session')
			current.nanocoderSessionId = 'replacement-session';
		else if (changed === 'cwd') current.sessionCwd = replacement;
		else
			store.projects.save({
				...project,
				canonicalRoot: replacement,
				sessionCwd: replacement,
			});
		store.threads.save(current);
		response.resolve({
			stopReason: 'end_turn',
			metadata: {usage: {totalTokens: 20}},
		});
		await refused;
		t.deepEqual(store.threads.get(project.id, thread.id), current);
		t.false(
			events.some(
				event =>
					event.type === 'turn' &&
					event.events.some(item => item.type === 'metadata'),
			),
		);
	});
}

test('detached turn response metadata cannot publish into a later renderer attachment (CHAT-19, ACP-13)', async t => {
	const events: ProjectEvent[] = [];
	const {service, supervisor, project} = await fixture(t, true, event =>
		events.push(event),
	);
	const thread = await service.createThread({projectId: project.id});
	await supervisor.ensureProcess(project);
	const entered = deferred<void>();
	const response = deferred<NanocoderTurnResult>();
	supervisor.getConnection(project.id).prompt = async () => {
		entered.resolve();
		return response.promise;
	};
	const request = {projectId: project.id, threadId: thread.id};
	const turn = service.promptThread({...request, text: 'old attachment'});
	await entered.promise;
	const detached = service.detach([]);
	response.resolve({
		stopReason: 'end_turn',
		metadata: {usage: {totalTokens: 20}},
	});
	await detached;
	t.deepEqual(await turn, {stopReason: 'end_turn'});
	t.false(
		events.some(
			event =>
				event.type === 'turn' &&
				event.events.some(item => item.type === 'metadata'),
		),
	);
	t.deepEqual((await service.getThreadSnapshot(request)).events, [
		{type: 'user', text: 'old attachment'},
	]);
	t.is((await service.getThreadSnapshot(request)).result, undefined);
	t.false(events.some(event => event.type === 'turn' && event.result));
});

test('resumed metadata remains part of the owned in-memory snapshot prefix (CHAT-19, CHAT-04)', async t => {
	const {service, supervisor, store, project} = await fixture(t, true);
	const thread = seed(project, {nanocoderSessionId: 'fake-session'});
	store.threads.save(thread);
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const original = connection.resumeSession;
	const metadata: TurnEvent = {
		type: 'metadata',
		metadata: {usage: {totalTokens: 30}},
	};
	connection.resumeSession = async (...args) => {
		const resumed = await original(...args);
		return {...resumed, history: [...resumed.history, metadata]};
	};
	const snapshot = await service.openThread({
		projectId: project.id,
		threadId: thread.id,
	});
	t.deepEqual(snapshot.events.at(-1), metadata);
	t.is(snapshot.sequence, 1);
});

test('removed desktop metadata also forgets the remembered recovery session without resuming it (CHAT-14, ACP-13)', async t => {
	const {service, supervisor, store, project} = await fixture(t, true);
	const thread = seed(project, {nanocoderSessionId: 'fake-session'});
	store.threads.save(thread);
	await service.openThread({projectId: project.id, threadId: thread.id});
	await service.removeThread({projectId: project.id, threadId: thread.id});
	await supervisor.stop(project.id);
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	await t.notThrowsAsync(
		service.restore(project, connection, new AbortController().signal),
	);
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event =>
				typeof event.method === 'string' && event.method.startsWith('session/'),
		),
	);
});

for (const recovery of [false, true]) {
	test(`${recovery ? 'recovery' : 'ordinary open'} preserves a generated title received during post-resume validation (CHAT-12)`, async t => {
		const {service, supervisor, store, project, notifyTitle} = await fixture(
			t,
			true,
		);
		const thread = seed(project, {nanocoderSessionId: 'fake-session'});
		store.threads.save(thread);
		if (recovery) {
			await service.openThread({projectId: project.id, threadId: thread.id});
			await supervisor.stop(project.id);
		}
		await supervisor.ensureProcess(project);
		const connection = supervisor.getConnection(project.id);
		const originalResume = connection.resumeSession;
		let resumed = false;
		connection.resumeSession = async (...args) => {
			const result = await originalResume(...args);
			resumed = true;
			return result;
		};
		const originalGet = store.projects.get.bind(store.projects);
		let reads = 0;
		store.projects.get = id => {
			const owner = originalGet(id);
			if (resumed && ++reads === 2)
				notifyTitle('fake-session', 'late generated title');
			return owner;
		};
		if (recovery)
			await service.restore(project, connection, new AbortController().signal);
		else await service.openThread({projectId: project.id, threadId: thread.id});
		t.is(
			store.threads.get(project.id, thread.id)?.title,
			'late generated title',
		);
		t.false(store.threads.getTitleManuallySet(project.id, thread.id));
	});
}

for (const action of [
	'archive',
	'rename',
	'remove',
	'delete history',
] as const) {
	test(`thread recovery refuses ${action} of its preparing row (ACP-13, CHAT-12, CHAT-14)`, async t => {
		const {service, supervisor, store, project} = await fixture(t, true);
		const thread = seed(project, {nanocoderSessionId: 'fake-session'});
		store.threads.save(thread);
		const request = {projectId: project.id, threadId: thread.id};
		await service.openThread(request);
		const connection = supervisor.getConnection(project.id);
		const original = connection.resumeSession;
		const entered = deferred<void>();
		const release = deferred<void>();
		connection.resumeSession = async (...args) => {
			const result = await original(...args);
			entered.resolve();
			await release.promise;
			return result;
		};
		const restoring = service.restore(
			project,
			connection,
			new AbortController().signal,
		);
		t.teardown(async () => {
			release.resolve();
			await restoring.catch(() => undefined);
		});
		await entered.promise;
		const mutation =
			action === 'archive'
				? service.archiveThread({...request, archived: true})
				: action === 'rename'
					? service.renameThread({...request, title: 'not saved'})
					: action === 'remove'
						? service.removeThread(request)
						: service.deleteThreadHistory(request);
		await t.throwsAsync(mutation, {instanceOf: IpcFailure, code: 'BUSY'});
	});
}

test('thread recovery refuses a located root or mismatched supplied connection before session resume (ACP-13, CHAT-01)', async t => {
	for (const changed of ['cwd', 'connection-root']) {
		const {root, service, supervisor, store, project} = await fixture(t, true);
		const thread = seed(project, {nanocoderSessionId: 'fake-session'});
		store.threads.save(thread);
		await service.openThread({projectId: project.id, threadId: thread.id});
		await supervisor.stop(project.id);
		const folder = path.join(root, 'located');
		mkdirSync(folder);
		const located = {...project, canonicalRoot: folder, sessionCwd: folder};
		if (changed === 'cwd') {
			store.projects.save(located);
			store.threads.save({...thread, sessionCwd: folder});
		}
		await supervisor.ensureProcess(located);
		const connection = supervisor.getConnection(project.id);
		await t.throwsAsync(
			service.restore(
				changed === 'cwd' ? located : project,
				connection,
				new AbortController().signal,
			),
			{instanceOf: IpcFailure, code: 'DENIED'},
		);
		t.false(
			fakeEvents(connection.stderr.lines()).some(
				event => event.method === 'session/resume',
			),
		);
	}
});

test('thread recovery refuses already-aborted and late-aborted mode results without replacing history (ACP-13)', async t => {
	for (const late of [false, true]) {
		const {service, supervisor, store, project} = await fixture(t, true);
		const thread = seed(project, {nanocoderSessionId: 'fake-session'});
		store.threads.save(thread);
		const request = {projectId: project.id, threadId: thread.id};
		const before = await service.openThread(request);
		const connection = supervisor.getConnection(project.id);
		const entered = deferred<void>();
		const release = deferred<void>();
		const original = connection.resumeSession;
		connection.resumeSession = async (...args) => {
			const result = await original(...args);
			entered.resolve();
			await release.promise;
			return result;
		};
		const abort = new AbortController();
		if (!late) abort.abort(new Error('cancelled recovery'));
		const restoring = service.restore(project, connection, abort.signal);
		const rejected = t.throwsAsync(restoring, {message: 'cancelled recovery'});
		if (late) {
			await entered.promise;
			abort.abort(new Error('cancelled recovery'));
		}
		release.resolve();
		await rejected;
		t.deepEqual(await service.getThreadSnapshot(request), before);
		t.false(service.activity(project.id).preparing);
	}
});

test('thread detach cancels a reopen queued behind idle stop without a second runtime resolution or spawn (ACP-13)', async t => {
	const {service, supervisor, store, project, clock, calls} = await fixture(
		t,
		true,
		undefined,
		true,
	);
	const thread = seed(project, {nanocoderSessionId: 'fake-session'});
	store.threads.save(thread);
	await service.openThread({projectId: project.id, threadId: thread.id});
	const connection = supervisor.getConnection(project.id);
	const release = deferred<void>();
	const originalClose = connection.close;
	connection.close = async () => {
		await release.promise;
		await originalClose();
	};
	t.teardown(() => release.resolve());
	await service.detach([project]);
	clock.advance(300_000);
	t.is(supervisor.getState(project.id).status, 'stopping');
	const reopened = supervisor.ensureProcess(project).catch(error => error);
	const detached = service.detach([project]);
	release.resolve();
	await detached;
	await reopened;
	t.is(calls.filter(call => call === 'launch').length, 1);
	t.is(supervisor.getState(project.id).status, 'stopped');
	t.is(service.activity(project.id).openSessions, 0);
});

test('thread detached cleanup settles every project even if one stop rejects (ACP-13)', async t => {
	const {root, service, supervisor, store, project} = await fixture(t, true);
	const folder = path.join(root, 'other');
	mkdirSync(folder);
	const other = {
		...project,
		id: randomUUID(),
		canonicalRoot: folder,
		sessionCwd: folder,
	};
	store.projects.save(other);
	const starting = [project, other].map(chosen =>
		supervisor.ensureProcess(chosen),
	);
	const originalStop = supervisor.stop.bind(supervisor);
	t.teardown(() => {
		supervisor.stop = originalStop;
	});
	const stopped: string[] = [];
	supervisor.stop = async id => {
		const state = await originalStop(id);
		stopped.push(id);
		if (id === project.id) throw new Error('fixture cleanup failure');
		return state;
	};
	await service.detach([project, other]);
	await Promise.all(starting);
	t.is(stopped.length, 2);
	t.is(supervisor.getState(project.id).status, 'stopped');
	t.is(supervisor.getState(other.id).status, 'stopped');
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
		{
			type: 'turn',
			projectId: project.id,
			threadId: thread.id,
			sequence: 2,
			events: [],
			result: {ok: true, value: {stopReason: 'end_turn'}},
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
	t.is(snapshot.sequence, 3);
	t.deepEqual(
		events.map(event => event.sequence),
		[1, 2, 3],
	);
	t.true(
		events.every(
			event => event.type === 'turn' && event.threadId === thread.id,
		),
	);
});

test('the next prompt preserves a generated title accepted during preparation (CHAT-12)', async t => {
	const {project, service, store, supervisor, notifyTitle} = await fixture(
		t,
		true,
	);
	const thread = await service.createThread({projectId: project.id});
	const request = {projectId: project.id, threadId: thread.id};
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).prompt = async () => ({
		stopReason: 'end_turn',
	});
	await service.promptThread({...request, text: 'first synthetic task'});
	const previous = store.threads.get(project.id, thread.id);
	if (!previous?.nanocoderSessionId) throw new Error('Missing saved session');
	const sessionId = previous.nanocoderSessionId;
	const ensure = supervisor.ensureProcess.bind(supervisor);
	supervisor.ensureProcess = async chosen => {
		const result = await ensure(chosen);
		notifyTitle(sessionId, 'generated between turns');
		t.is(
			store.threads.get(project.id, thread.id)?.title,
			'generated between turns',
		);
		return result;
	};
	await service.promptThread({...request, text: 'second synthetic task'});
	t.like(store.threads.get(project.id, thread.id), {
		...previous,
		title: 'generated between turns',
	});
	t.false(store.threads.getTitleManuallySet(project.id, thread.id));
});

test('recovery preserves a generated title accepted after its final async owner check (CHAT-12)', async t => {
	const {project, service, store, supervisor, notifyTitle} = await fixture(
		t,
		true,
	);
	const thread = seed(project, {nanocoderSessionId: 'fake-session'});
	store.threads.save(thread);
	const request = {projectId: project.id, threadId: thread.id};
	await service.openThread(request);
	await supervisor.stop(project.id);
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	const resume = connection.resumeSession;
	let resumed = false;
	connection.resumeSession = async (...args) => {
		const result = await resume(...args);
		resumed = true;
		return result;
	};
	const get = store.threads.get.bind(store.threads);
	let reads = 0;
	let accepted = false;
	store.threads.get = (projectId, threadId) => {
		const current = get(projectId, threadId);
		if (resumed && ++reads === 2)
			queueMicrotask(() => {
				notifyTitle('fake-session', 'generated after recovery check');
				accepted =
					get(project.id, thread.id)?.title ===
					'generated after recovery check';
			});
		return current;
	};
	await service.restore(project, connection, new AbortController().signal);
	t.true(accepted);
	t.like(get(project.id, thread.id), {
		...thread,
		title: 'generated after recovery check',
	});
});

for (const delivery of ['metadata', 'success terminal', 'failure terminal']) {
	test(`turn state preserves a generated title accepted by the ${delivery} listener (CHAT-12)`, async t => {
		let observe: ((event: ProjectEvent) => void) | undefined;
		const {project, service, store, supervisor, notifyTitle} = await fixture(
			t,
			true,
			event => observe?.(event),
		);
		const thread = await service.createThread({projectId: project.id});
		const request = {projectId: project.id, threadId: thread.id};
		await supervisor.ensureProcess(project);
		const connection = supervisor.getConnection(project.id);
		connection.prompt = async () => ({stopReason: 'end_turn'});
		await service.promptThread({...request, text: 'first synthetic task'});
		const previous = store.threads.get(project.id, thread.id);
		if (!previous?.nanocoderSessionId) throw new Error('Missing saved session');
		const sessionId = previous.nanocoderSessionId;
		let accepted = false;
		observe = event => {
			if (
				event.type === 'turn' &&
				(delivery === 'metadata'
					? event.events.some(item => item.type === 'metadata')
					: event.result !== undefined)
			) {
				notifyTitle(sessionId, 'generated at turn end');
				accepted =
					store.threads.get(project.id, thread.id)?.title ===
					'generated at turn end';
			}
		};
		connection.prompt = async () => {
			if (delivery === 'failure terminal')
				throw new NanocoderFailure(
					'AGENT_UNAVAILABLE',
					'Synthetic prompt failed',
				);
			return {stopReason: 'end_turn', metadata: {usage: {totalTokens: 20}}};
		};
		const prompted = service.promptThread({
			...request,
			text: 'second synthetic task',
		});
		if (delivery === 'failure terminal')
			await t.throwsAsync(prompted, {instanceOf: IpcFailure});
		else await prompted;
		t.true(accepted);
		t.like(store.threads.get(project.id, thread.id), {
			...previous,
			runState: delivery === 'failure terminal' ? 'failed' : 'ready',
			title: 'generated at turn end',
		});
	});
}

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

test('a history confirmation returned after detach cannot launch or delete anything (CHAT-14, ACP-13)', async t => {
	const {service, store, project, calls, confirmDeletion} = await fixture(
		t,
		true,
	);
	const thread = seed(project);
	store.threads.save(thread);
	const entered = deferred<void>();
	const answer = deferred<boolean>();
	confirmDeletion(() => {
		entered.resolve();
		return answer.promise;
	});
	const deleting = service.deleteThreadHistory({
		projectId: project.id,
		threadId: thread.id,
	});
	const rejected = t.throwsAsync(deleting, {
		instanceOf: IpcFailure,
		code: 'AGENT_UNAVAILABLE',
	});
	await entered.promise;
	await service.detach([project]);
	answer.resolve(true);
	await rejected;
	t.deepEqual(calls, ['confirm-delete']);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
});

for (const action of ['rename', 'delete'] as const) {
	test(`a late upstream ${action} result cannot mutate desktop metadata after detach (CHAT-12, CHAT-14, ACP-13)`, async t => {
		const {service, store, supervisor, project, confirmDeletion} =
			await fixture(t, true);
		const thread = seed(project);
		store.threads.save(thread);
		writeFileSync(
			path.join(project.canonicalRoot, '.fake-nanocoder'),
			'extensions',
		);
		await supervisor.ensureProcess(project);
		const connection = supervisor.getConnection(project.id);
		const entered = deferred<void>();
		const answer = deferred<void>();
		connection.renameSession = async () => {
			entered.resolve();
			await answer.promise;
			return 'late fixture title';
		};
		connection.deleteSession = async () => {
			entered.resolve();
			await answer.promise;
		};
		confirmDeletion(async () => true);
		const request = {projectId: project.id, threadId: thread.id};
		const mutation =
			action === 'rename'
				? service.renameThread({...request, title: 'late fixture title'})
				: service.deleteThreadHistory(request);
		const rejected = t.throwsAsync(mutation, {
			instanceOf: IpcFailure,
			code: 'AGENT_UNAVAILABLE',
		});
		await entered.promise;
		await service.detach([project]);
		answer.resolve();
		await rejected;
		t.deepEqual(store.threads.get(project.id, thread.id), thread);
		t.false(store.threads.getTitleManuallySet(project.id, thread.id));
		t.is(
			(await service.archiveThread({...request, archived: true})).archiveState,
			'archived',
		);
	});
}

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

test('generated titles map only saved IDs in their live owning project (CHAT-12)', async t => {
	const {project, service, store, supervisor, notifyTitle, root} =
		await fixture(t, true);
	const thread = seed(project, {nanocoderSessionId: 'fixture-session'});
	store.threads.save(thread);
	const otherRoot = path.join(root, 'other');
	mkdirSync(otherRoot);
	const other = {
		...project,
		id: randomUUID(),
		canonicalRoot: otherRoot,
		sessionCwd: otherRoot,
	};
	store.projects.save(other);
	const otherThread = seed(other, {
		nanocoderSessionId: 'other-fixture-session',
	});
	store.threads.save(otherThread);
	await supervisor.ensureProcess(project);
	notifyTitle('other-fixture-session', 'wrong project title');
	notifyTitle('unknown-fixture-session', 'unknown session title');
	t.deepEqual(store.threads.get(other.id, otherThread.id), otherThread);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	notifyTitle('fixture-session', 'fixture generated title');
	t.is(
		store.threads.get(project.id, thread.id)?.title,
		'fixture generated title',
	);
	await supervisor.stop(project.id);
	notifyTitle('fixture-session', 'stale process title');
	t.is(
		(
			await service.getThreadSnapshot({
				projectId: project.id,
				threadId: thread.id,
			})
		).thread.title,
		'fixture generated title',
	);
});

test('renaming a desktop-only thread stores manual metadata without starting Nanocoder (CHAT-12)', async t => {
	const {project, service, store, calls} = await fixture(t);
	const thread = await service.createThread({projectId: project.id});
	const renamed = await service.renameThread({
		projectId: project.id,
		threadId: thread.id,
		title: '  fixture manual title  ',
	});
	t.deepEqual(renamed, {...thread, title: 'fixture manual title'});
	t.deepEqual(store.threads.get(project.id, thread.id), renamed);
	t.true(store.threads.getTitleManuallySet(project.id, thread.id));
	t.deepEqual(calls, []);
});

test('a manual rename survives a first-turn process crash and a later generated title (CHAT-12)', async t => {
	const {project, service, store, supervisor, notifyTitle, root} =
		await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	const target = {projectId: project.id, threadId: thread.id};
	await service.renameThread({...target, title: 'fixture manual title'});
	const modeFile = path.join(project.canonicalRoot, '.fake-nanocoder');
	writeFileSync(modeFile, 'die-in-turn');
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	await t.throwsAsync(
		service.promptThread({...target, text: 'fixture first turn'}),
		{code: 'AGENT_UNAVAILABLE'},
	);
	t.is((await connection.exited).code, 3);
	await supervisor.stop(project.id);
	service.dispose();
	store.close();
	const reopened = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	const restored = createThreadService({store: reopened, supervisor});
	t.teardown(() => {
		restored.dispose();
		reopened.close();
	});
	t.true(reopened.threads.getTitleManuallySet(project.id, thread.id));
	t.is(
		reopened.threads.get(project.id, thread.id)?.title,
		'fixture manual title',
	);
	writeFileSync(modeFile, 'ok');
	await supervisor.ensureProcess(project);
	notifyTitle('fake-session', 'late generated title');
	const snapshot = await restored.getThreadSnapshot(target);
	t.is(snapshot.thread.title, 'fixture manual title');
	t.is(snapshot.thread.nanocoderSessionId, 'fake-session');
	t.deepEqual(snapshot.events, []);
});

test('a manual title equal to the new-thread label is not replaced by first-prompt text (CHAT-12)', async t => {
	const {project, service, supervisor} = await fixture(t, true);
	const thread = await service.createThread({projectId: project.id});
	const target = {projectId: project.id, threadId: thread.id};
	await service.renameThread({...target, title: 'new thread'});
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).prompt = async () => ({
		stopReason: 'end_turn',
	});
	await service.promptThread({...target, text: 'fixture first turn'});
	t.is((await service.getThreadSnapshot(target)).thread.title, 'new thread');
});

test('renaming saved history uses its probed session and wins over generated titles (CHAT-12)', async t => {
	const {project, service, store, supervisor, notifyTitle} = await fixture(
		t,
		true,
	);
	const thread = seed(project);
	store.threads.save(thread);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'extensions',
	);
	await supervisor.ensureProcess(project);
	const calls: unknown[] = [];
	supervisor.getConnection(project.id).renameSession = async (
		sessionId,
		title,
	) => {
		calls.push({sessionId, title});
		t.false(store.threads.getTitleManuallySet(project.id, thread.id));
		notifyTitle(sessionId, 'in-flight generated title');
		return 'fixture renamed title';
	};
	const renamed = await service.renameThread({
		projectId: project.id,
		threadId: thread.id,
		title: ' fixture manual title ',
	});
	t.deepEqual(calls, [
		{sessionId: thread.nanocoderSessionId, title: 'fixture manual title'},
	]);
	t.deepEqual(renamed, {...thread, title: 'fixture renamed title'});
	t.true(store.threads.getTitleManuallySet(project.id, thread.id));
	notifyTitle(thread.nanocoderSessionId ?? '', 'late generated title');
	t.deepEqual(store.threads.get(project.id, thread.id), renamed);
});

test('history rename refuses an unprobed extension without changing local metadata (CHAT-12)', async t => {
	const {project, service, store, supervisor} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	await supervisor.ensureProcess(project);
	let called = false;
	supervisor.getConnection(project.id).renameSession = async () => {
		called = true;
		return 'unexpected title';
	};
	await t.throwsAsync(
		service.renameThread({
			projectId: project.id,
			threadId: thread.id,
			title: 'fixture manual title',
		}),
		{code: 'UNSUPPORTED'},
	);
	t.false(called);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	t.false(store.threads.getTitleManuallySet(project.id, thread.id));
});

test('a rejected upstream rename preserves the local title and automatic flag (CHAT-12)', async t => {
	const {project, service, store, supervisor} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'extensions',
	);
	await supervisor.ensureProcess(project);
	supervisor.getConnection(project.id).renameSession = async () => {
		throw new NanocoderFailure('AGENT_UNAVAILABLE', 'fixture rename failed');
	};
	await t.throwsAsync(
		service.renameThread({
			projectId: project.id,
			threadId: thread.id,
			title: 'fixture manual title',
		}),
		{code: 'AGENT_UNAVAILABLE'},
	);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	t.false(store.threads.getTitleManuallySet(project.id, thread.id));
});

test('a late rename answer cannot update a changed session identity (CHAT-12)', async t => {
	const {project, service, store, supervisor} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'extensions',
	);
	await supervisor.ensureProcess(project);
	const changed = {...thread, nanocoderSessionId: 'changed-fixture-session'};
	supervisor.getConnection(project.id).renameSession = async () => {
		store.threads.save(changed);
		return 'fixture manual title';
	};
	await t.throwsAsync(
		service.renameThread({
			projectId: project.id,
			threadId: thread.id,
			title: 'fixture manual title',
		}),
		{code: 'DENIED'},
	);
	t.deepEqual(store.threads.get(project.id, thread.id), changed);
	t.false(store.threads.getTitleManuallySet(project.id, thread.id));
});

test('a pending upstream rename locks the desktop row until its answer (CHAT-12)', async t => {
	const {project, service, store, supervisor} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'extensions',
	);
	await supervisor.ensureProcess(project);
	const entered = deferred<void>();
	const answer = deferred<string>();
	supervisor.getConnection(project.id).renameSession = async () => {
		entered.resolve();
		return answer.promise;
	};
	const target = {projectId: project.id, threadId: thread.id};
	const rename = service.renameThread({
		...target,
		title: 'fixture manual title',
	});
	void rename.catch(() => undefined);
	const state = await Promise.race([
		entered.promise.then(() => 'entered'),
		rename.then(
			() => 'finished',
			() => 'failed',
		),
	]);
	let removal: string;
	try {
		removal = await service.removeThread(target).then(
			() => 'allowed',
			(error: IpcFailure) => error.code,
		);
	} finally {
		answer.resolve('fixture manual title');
		await rename.catch(() => undefined);
	}
	t.is(state, 'entered');
	t.is(removal, 'BUSY');
	t.true(store.threads.getTitleManuallySet(project.id, thread.id));
});

test('an invalid stored-history title is refused before any process starts (CHAT-12)', async t => {
	const {project, service, store, calls} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	for (const title of ['', '   ', 't'.repeat(501)])
		await t.throwsAsync(
			service.renameThread({
				projectId: project.id,
				threadId: thread.id,
				title,
			}),
			{code: 'VALIDATION'},
		);
	t.deepEqual(calls, []);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
});

test('project thread and supervisor metadata share one scoped sequence and cloned payloads (CHAT-03)', async t => {
	const {project, supervisor} = await fixture(t, true);
	const thread = seed(project);
	const changed = {...thread, title: 'fixture changed title'};
	const events: ProjectEvent[] = [];
	supervisor.subscribe(event => {
		if (event.type === 'thread') event.thread.title = 'listener mutation';
	});
	supervisor.subscribe(event => events.push(event));
	supervisor.announceProject(project);
	supervisor.publishThread(thread);
	await supervisor.ensureProcess(project);
	supervisor.publishThread(changed);
	supervisor.publishThreadRemoved(project.id, thread.id);
	supervisor.replayState(project.id);
	t.deepEqual(
		events.flatMap(event => (event.type === 'thread' ? [event.thread] : [])),
		[thread, changed],
	);
	t.true(events.some(event => event.type === 'project'));
	t.true(events.some(event => event.type === 'supervisor'));
	t.deepEqual(
		events.flatMap(event =>
			event.type === 'thread-removed' ? [event.threadId] : [],
		),
		[thread.id],
	);
	t.deepEqual(
		events.map(event => event.sequence),
		Array.from({length: events.length}, (_, index) => index + 1),
	);
	const other = {...project, id: randomUUID()};
	const otherId = randomUUID();
	supervisor.announceProject(other);
	supervisor.publishThreadRemoved(other.id, otherId);
	t.deepEqual(
		events
			.filter(event => event.projectId === other.id)
			.map(event => event.sequence),
		[1, 2],
	);
	t.is(thread.title, 'fixture thread');
});

test('thread metadata operations publish stored changes and a distinct removal event (CHAT-03, CHAT-12, CHAT-13, CHAT-14)', async t => {
	const {project, service, supervisor, calls} = await fixture(t);
	const events: ProjectEvent[] = [];
	supervisor.subscribe(event => events.push(event));
	const created = await service.createThread({projectId: project.id});
	const target = {projectId: project.id, threadId: created.id};
	const renamed = await service.renameThread({
		...target,
		title: 'fixture renamed',
	});
	const archived = await service.archiveThread({...target, archived: true});
	await service.removeThread(target);
	t.deepEqual(
		events.flatMap(event => (event.type === 'thread' ? [event.thread] : [])),
		[created, renamed, archived],
	);
	t.deepEqual(
		events.map(event => event.type),
		['thread', 'thread', 'thread', 'thread-removed'],
	);
	t.deepEqual(
		events.map(event => event.sequence),
		[1, 2, 3, 4],
	);
	t.like(events[3], {...target, type: 'thread-removed'});
	t.deepEqual(calls, []);
});

test('session prompt and title metadata publish in order before user content and ignore manual overrides (CHAT-04, CHAT-12)', async t => {
	const order: string[] = [];
	const {project, service, supervisor, notifyTitle} = await fixture(
		t,
		true,
		event => {
			if (
				event.type === 'turn' &&
				event.events.some(item => item.type === 'user')
			)
				order.push('user');
		},
	);
	const metadata: ThreadInfo[] = [];
	supervisor.subscribe(event => {
		if (event.type === 'thread') {
			metadata.push(event.thread);
			order.push(`${event.thread.runState}:${event.thread.nanocoderSessionId}`);
		}
	});
	const created = await service.createThread({projectId: project.id});
	writeFileSync(
		path.join(project.canonicalRoot, '.fake-nanocoder'),
		'extensions',
	);
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	connection.prompt = async sessionId => {
		notifyTitle(sessionId, 'fixture generated');
		return {stopReason: 'end_turn'};
	};
	connection.renameSession = async (_sessionId, title) => title;
	const target = {projectId: project.id, threadId: created.id};
	await service.promptThread({...target, text: 'fixture prompt'});
	t.deepEqual(
		metadata.map(row => [row.runState, row.title, row.nanocoderSessionId]),
		[
			['new', 'new thread', null],
			['new', 'new thread', 'fake-session'],
			['running', 'fixture prompt', 'fake-session'],
			['running', 'fixture generated', 'fake-session'],
			['ready', 'fixture generated', 'fake-session'],
		],
	);
	t.true(order.indexOf('new:fake-session') < order.indexOf('user'));
	await service.renameThread({...target, title: 'fixture manual'});
	t.is(metadata.at(-1)?.title, 'fixture manual');
	t.is(metadata.length, 6);
	notifyTitle('fake-session', 'late generated');
	t.is(metadata.length, 6);
});

test('missing-history view-only state is published without changing thread identity (CHAT-04)', async t => {
	const {project, service, store, supervisor} = await fixture(t, true);
	const thread = seed(project);
	store.threads.save(thread);
	const events: ProjectEvent[] = [];
	supervisor.subscribe(event => events.push(event));
	const snapshot = await service.openThread({
		projectId: project.id,
		threadId: thread.id,
	});
	t.deepEqual(
		events.flatMap(event => (event.type === 'thread' ? [event.thread] : [])),
		[snapshot.thread],
	);
	t.is(snapshot.thread.nanocoderSessionId, thread.nanocoderSessionId);
	t.is(snapshot.thread.runState, 'view-only');
});

test('waiting metadata remains until every concurrent permission closes (CHAT-06, U.3)', async t => {
	const {project, store, supervisor, target, turn, requests, metadata} =
		await waitingThread(t, true);
	t.is(
		store.threads.get(project.id, target.threadId)?.runState,
		'waiting-approval',
	);
	t.true(
		supervisor.answerPermission(
			project.id,
			'fake-session',
			requests[0].id,
			'allow',
		),
	);
	t.is(
		store.threads.get(project.id, target.threadId)?.runState,
		'waiting-approval',
	);
	t.true(
		supervisor.answerPermission(
			project.id,
			'fake-session',
			requests[1].id,
			'deny',
		),
	);
	t.is(store.threads.get(project.id, target.threadId)?.runState, 'running');
	t.deepEqual(await turn, {stopReason: 'end_turn'});
	t.deepEqual(
		metadata.map(row => row.runState),
		['new', 'new', 'running', 'waiting-approval', 'running', 'ready'],
	);
});

test('thread approval answers refuse unknown unoffered wrong-thread and closed requests (ACP-10, CHAT-06)', async t => {
	const {
		project,
		store,
		service,
		supervisor,
		connection,
		target,
		turn,
		requests,
	} = await waitingThread(t);
	const other = seed(project);
	store.threads.save(other);
	const answer = {...target, requestId: requests[0].id, optionId: 'allow'};
	for (const [request, code] of [
		[{...answer, threadId: randomUUID()}, 'NOT_FOUND'],
		[{...answer, projectId: randomUUID()}, 'NOT_FOUND'],
		[{...answer, threadId: other.id}, 'DENIED'],
		[{...answer, requestId: 'unknown-request'}, 'DENIED'],
		[{...answer, optionId: 'not-offered'}, 'DENIED'],
	] as const)
		await t.throwsAsync(service.answerThreadPermission(request), {
			instanceOf: IpcFailure,
			code,
		});
	t.is(
		store.threads.get(project.id, target.threadId)?.runState,
		'waiting-approval',
	);
	t.is(await service.answerThreadPermission(answer), null);
	t.deepEqual(await turn, {stopReason: 'end_turn'});
	await t.throwsAsync(service.answerThreadPermission(answer), {
		instanceOf: IpcFailure,
		code: 'DENIED',
	});
	await supervisor.close();
	t.deepEqual(
		fakeEvents(connection.stderr.lines())
			.filter(event => 'answer' in event)
			.map(event => event.answer),
		[{outcome: 'selected', optionId: 'allow'}],
	);
});

test('thread cancellation scopes the active session and cancels every approval without allowing it (ACP-10, CHAT-06)', async t => {
	const {
		project,
		store,
		service,
		supervisor,
		connection,
		target,
		turn,
		requests,
	} = await waitingThread(t, true);
	const other = seed(project);
	store.threads.save(other);
	t.is(await service.cancelThread({...target, threadId: other.id}), null);
	t.is(supervisor.getState(project.id).activeThreadId, 'fake-session');
	t.is(await service.cancelThread(target), null);
	t.deepEqual(await turn, {stopReason: 'cancelled'});
	t.is(store.threads.get(project.id, target.threadId)?.runState, 'interrupted');
	for (const request of requests)
		await t.throwsAsync(
			service.answerThreadPermission({
				...target,
				requestId: request.id,
				optionId: 'allow',
			}),
			{instanceOf: IpcFailure, code: 'DENIED'},
		);
	await supervisor.close();
	t.deepEqual(
		fakeEvents(connection.stderr.lines())
			.filter(event => 'answer' in event)
			.map(event => event.answer),
		[{outcome: 'cancelled'}],
	);
});

test('cancelling a sessionless thread is local and unknown targets are refused (ACP-10)', async t => {
	const {project, service, calls} = await fixture(t);
	const thread = await service.createThread({projectId: project.id});
	const target = {projectId: project.id, threadId: thread.id};
	t.is(await service.cancelThread(target), null);
	await t.throwsAsync(
		service.cancelThread({...target, threadId: randomUUID()}),
		{instanceOf: IpcFailure, code: 'NOT_FOUND'},
	);
	t.deepEqual(calls, []);
});

test('revoked trust refuses a live approval but still permits cancelling the turn (ACP-10, SEC-17)', async t => {
	const {
		project,
		store,
		service,
		supervisor,
		connection,
		target,
		turn,
		requests,
	} = await waitingThread(t);
	store.projects.save({...project, trusted: false});
	await t.throwsAsync(
		service.answerThreadPermission({
			...target,
			requestId: requests[0].id,
			optionId: 'allow',
		}),
		{instanceOf: IpcFailure, code: 'DENIED'},
	);
	t.is(await service.cancelThread(target), null);
	t.deepEqual(await turn, {stopReason: 'cancelled'});
	await supervisor.close();
	t.deepEqual(
		fakeEvents(connection.stderr.lines())
			.filter(event => 'answer' in event)
			.map(event => event.answer),
		[{outcome: 'cancelled'}],
	);
});

for (const mode of ['prompt-error', 'die-in-turn']) {
	test(`${mode} publishes failed instead of leaving the thread running (CHAT-15, DEC-33)`, async t => {
		const {project, store, service, supervisor} = await fixture(t, true);
		writeFileSync(path.join(project.canonicalRoot, '.fake-nanocoder'), mode);
		const metadata: ThreadInfo[] = [];
		supervisor.subscribe(event => {
			if (event.type === 'thread') metadata.push(event.thread);
		});
		const thread = await service.createThread({projectId: project.id});
		await t.throwsAsync(
			service.promptThread({
				projectId: project.id,
				threadId: thread.id,
				text: 'fixture prompt',
			}),
			{instanceOf: IpcFailure, code: 'AGENT_UNAVAILABLE'},
		);
		const stored = store.threads.get(project.id, thread.id);
		t.is(stored?.runState, 'failed');
		t.is(stored?.nanocoderSessionId, 'fake-session');
		t.is(stored?.title, 'fixture prompt');
		t.is(metadata.at(-1)?.runState, 'failed');
	});
}

test('another running thread remains readable without persisted view-only state or session switching (CHAT-17)', async t => {
	const {project, store, service, supervisor, connection, target, turn} =
		await waitingThread(t);
	const other = seed(project);
	store.threads.save(other);
	connection.resumeSession = async () => {
		throw new Error('A running turn must not switch sessions');
	};
	const otherTarget = {projectId: project.id, threadId: other.id};
	const snapshot = await service.openThread(otherTarget);
	t.deepEqual(snapshot.thread, other);
	t.deepEqual(snapshot.events, []);
	t.is(supervisor.getState(project.id).activeThreadId, 'fake-session');
	await t.throwsAsync(
		service.promptThread({...otherTarget, text: 'fixture overlap'}),
		{instanceOf: IpcFailure, code: 'BUSY'},
	);
	await service.cancelThread(target);
	await turn;
	t.deepEqual(store.threads.get(project.id, other.id), other);
});

test('opening untrusted history refuses without persisting a permanent view-only state (CHAT-15, SEC-17)', async t => {
	const {project, store, service, calls} = await fixture(t);
	const thread = seed(project);
	store.threads.save(thread);
	await t.throwsAsync(
		service.openThread({projectId: project.id, threadId: thread.id}),
		{instanceOf: IpcFailure, code: 'DENIED'},
	);
	t.deepEqual(store.threads.get(project.id, thread.id), thread);
	t.deepEqual(calls, []);
});

test('resuming retains the owning thread mode rather than a later project default (DEC-31)', async t => {
	const {project, store, service, supervisor} = await fixture(t, true);
	const thread = seed(project, {
		nanocoderSessionId: 'fake-session',
		mode: 'normal',
	});
	store.threads.save(thread);
	const snapshot = await service.openThread({
		projectId: project.id,
		threadId: thread.id,
	});
	t.is(snapshot.thread.mode, 'normal');
	const connection = supervisor.getConnection(project.id);
	await supervisor.close();
	t.deepEqual(
		fakeEvents(connection.stderr.lines())
			.filter(event => event.method === 'session/set_mode')
			.map(event => (event.params as {modeId: string}).modeId),
		['normal'],
	);
});

test('first prompt retains the new thread captured mode after its project default changes (DEC-31)', async t => {
	const {project, store, service, supervisor} = await fixture(t, true);
	store.projects.save({...project, defaultMode: 'normal'});
	const thread = await service.createThread({projectId: project.id});
	store.projects.save(project);
	await supervisor.ensureProcess(project);
	const connection = supervisor.getConnection(project.id);
	connection.prompt = async () => ({stopReason: 'end_turn'});
	await service.promptThread({
		projectId: project.id,
		threadId: thread.id,
		text: 'fixture prompt',
	});
	t.is(store.threads.get(project.id, thread.id)?.mode, 'normal');
	await supervisor.close();
	t.deepEqual(
		fakeEvents(connection.stderr.lines())
			.filter(event => event.method === 'session/set_mode')
			.map(event => (event.params as {modeId: string}).modeId),
		['normal'],
	);
});
