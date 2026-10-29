import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import type {
	ConnectOptions,
	NanocoderConnection,
} from '@/main/nanocoder/acp-client';
import {FakeClock} from '@/main/nanocoder/fixtures/fake-clock';
import {
	fakeEvents,
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {connectProject} from '@/main/nanocoder/open-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {TechnicalSessions} from '@/main/nanocoder/technical-sessions';
import type {ProjectEvent, ProjectInfo} from '@/shared/ipc';

const project = (mode?: string): ProjectInfo => {
	const root = fakeProject(mode);
	return {
		id: randomUUID(),
		canonicalRoot: root,
		sessionCwd: root,
		displayName: 'fixture',
		trusted: true,
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
};
const runtime = {
	...fakeRuntime,
	version: '9.9.9',
	nodeVersion: process.version,
	source: 'override' as const,
};
const next = (
	supervisor: ProjectSupervisor,
	match: (event: ProjectEvent) => boolean,
) =>
	new Promise<ProjectEvent>(resolve => {
		const off = supervisor.subscribe(event => {
			if (match(event)) {
				off();
				resolve(event);
			}
		});
	});
test.after.always(removeFakeProjects);

test('records exit and schedules a bounded retry without replaying the failed prompt', async t => {
	const clock = new FakeClock();
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	await supervisor.getConnection(chosen.id).newSession('normal');
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	await t.throwsAsync(
		supervisor.prompt(chosen.id, 'fake-session', 'synthetic'),
	);
	await failed;
	const state = supervisor.getState(chosen.id);
	t.is(state.exit?.code, 3);
	t.is(state.restart.attempt, 1);
	t.is(state.restart.limit, 3);
	t.is(state.restart.nextAttemptAt, new Date(clock.now() + 1000).toISOString());
	clock.advance(999);
	t.is(supervisor.getState(chosen.id).status, 'failed');
	const ready = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'ready',
	);
	clock.advance(1);
	await ready;
	t.is(supervisor.getState(chosen.id).restart.attempt, 1);
});

test('crash-loop budget survives ready starts and explicit retry resets it', async t => {
	const clock = new FakeClock();
	let launches = 0;
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => {
			launches++;
			return {ok: true, runtime};
		},
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	for (let attempt = 1; attempt <= 4; attempt++) {
		await supervisor.getConnection(chosen.id).newSession('normal');
		const failed = next(
			supervisor,
			event => event.type === 'supervisor' && event.state.status === 'failed',
		);
		await t.throwsAsync(
			supervisor.prompt(chosen.id, 'fake-session', 'synthetic'),
		);
		await failed;
		t.is(supervisor.getState(chosen.id).restart.attempt, Math.min(attempt, 3));
		if (attempt <= 3) {
			const delay = 1000 * 2 ** (attempt - 1);
			t.is(
				supervisor.getState(chosen.id).restart.nextAttemptAt,
				new Date(clock.now() + delay).toISOString(),
			);
			const ready = next(
				supervisor,
				event => event.type === 'supervisor' && event.state.status === 'ready',
			);
			clock.advance(delay);
			await ready;
		}
	}
	t.is(clock.pending, 0);
	t.is(supervisor.getState(chosen.id).restart.nextAttemptAt, null);
	clock.advance(60_000);
	t.is(launches, 4);
	const results = await Promise.all([
		supervisor.restart(chosen),
		supervisor.restart(chosen),
	]);
	t.true(
		results.every(
			state => state.status === 'ready' && state.restart.attempt === 0,
		),
	);
	t.is(launches, 5);
});

test('recovery restores the selected session in its safe mode before publishing ready', async t => {
	const clock = new FakeClock();
	let sessions: TechnicalSessions;
	let restored = 0;
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
		recover: async (chosen, connection, signal) => {
			if (sessions) {
				await sessions.restore(chosen, connection, signal);
				restored++;
			}
		},
	});
	sessions = new TechnicalSessions(supervisor);
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	const original = await sessions.prepare(chosen);
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	await t.throwsAsync(supervisor.prompt(chosen.id, original.id, 'synthetic'));
	await failed;
	const ready = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'ready',
	);
	clock.advance(1000);
	await ready;
	t.is(restored, 1);
	const resumed = await sessions.prepare(chosen);
	t.deepEqual(resumed, original);
	t.is(resumed.mode, 'normal');
});

test('detaching a failed selected session cancels its pending recovery', async t => {
	const clock = new FakeClock();
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	const sessions = new TechnicalSessions(supervisor);
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	const original = await sessions.prepare(chosen);
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	await t.throwsAsync(supervisor.prompt(chosen.id, original.id, 'synthetic'));
	await failed;
	await sessions.detach([chosen]);
	t.is(clock.pending, 0);
	clock.advance(60_000);
	t.is(supervisor.getState(chosen.id).status, 'stopped');
});

test('ordinary reopen lets failed cached preparation stop and clear its session before a fresh open', async t => {
	let sessions: TechnicalSessions;
	const supervisor = new ProjectSupervisor({
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
		recover: (chosen, connection, signal) =>
			sessions.restore(chosen, connection, signal),
	});
	sessions = new TechnicalSessions(supervisor);
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	await sessions.prepare(chosen);
	await supervisor.stop(chosen.id);
	writeFileSync(
		path.join(chosen.canonicalRoot, '.fake-nanocoder'),
		'missing-session',
	);
	t.is((await supervisor.ensureProcess(chosen)).status, 'ready');
	await t.throwsAsync(sessions.prepare(chosen), {
		code: 'NOT_FOUND',
	});
	t.is(supervisor.getState(chosen.id).status, 'stopped');
	t.is((await supervisor.ensureProcess(chosen)).status, 'ready');
	t.is((await sessions.prepare(chosen)).mode, 'normal');
});

test('idle shutdown waits for turns, open sessions, preparation and recent activity, then closes loaded sessions', async t => {
	const clock = new FakeClock();
	const activity = {
		runningTurn: false,
		openSessions: 1,
		preparing: false,
		lastActivityAt: clock.now(),
	};
	const supervisor = new ProjectSupervisor({
		clock,
		idleTimeoutMs: 1000,
		activity: () => activity,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const connection = supervisor.getConnection(chosen.id);
	await connection.newSession('normal');
	clock.advance(1000);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	activity.openSessions = 0;
	activity.preparing = true;
	clock.advance(1000);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	activity.preparing = false;
	activity.runningTurn = true;
	clock.advance(1000);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	activity.runningTurn = false;
	activity.lastActivityAt = clock.now() + 500;
	clock.advance(1000);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	clock.advance(499);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	t.is(clock.pending, 1);
	const stopped = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'stopped',
	);
	clock.advance(1);
	await stopped;
	t.deepEqual(await connection.exited, {code: 0, signal: null});
	t.true(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/close',
		),
	);
	t.is(clock.pending, 0);
	const restarted = await Promise.all([
		supervisor.ensureProcess(chosen),
		supervisor.ensureProcess(chosen),
	]);
	t.true(restarted.every(state => state.status === 'ready'));
	t.not(supervisor.getConnection(chosen.id), connection);
});

test('technical activity tracks attached sessions and preparation without owning thread metadata', async t => {
	const clock = new FakeClock();
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	const sessions = new TechnicalSessions(supervisor, clock);
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	t.deepEqual(sessions.activity(chosen.id), {
		runningTurn: false,
		openSessions: 0,
		preparing: false,
		lastActivityAt: 0,
	});
	const preparing = sessions.prepare(chosen);
	t.deepEqual(sessions.activity(chosen.id), {
		runningTurn: false,
		openSessions: 1,
		preparing: true,
		lastActivityAt: clock.now(),
	});
	await preparing;
	t.false(sessions.activity(chosen.id).preparing);
	clock.advance(500);
	await sessions.detach([chosen]);
	t.deepEqual(sessions.activity(chosen.id), {
		runningTurn: false,
		openSessions: 0,
		preparing: false,
		lastActivityAt: clock.now(),
	});
	t.is(supervisor.getState(chosen.id).status, 'ready');
	await sessions.prepare(chosen);
	t.is(sessions.activity(chosen.id).openSessions, 1);
});

test('diagnostics captures an immutable redacted project snapshot that survives restart without conversation payloads', async t => {
	const clock = new FakeClock();
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const connection = supervisor.getConnection(chosen.id);
	connection.stderr.append(
		'fixture-marker Authorization: Bearer private-value',
	);
	connection.stderr.append(
		'{"prompt":[{"text":"private-conversation"}],"env":{"API_KEY":"private-environment"}}',
	);
	const snapshot = supervisor.getDiagnostics(chosen.id);
	t.true(snapshot.lines.some(line => line.includes('fixture-marker')));
	t.false(snapshot.lines.join('\n').includes('private-'));
	snapshot.lines.push('forged');
	t.false(
		supervisor
			.getCapturedDiagnostics(chosen.id, snapshot.id)
			.lines.includes('forged'),
	);
	await supervisor.restart(chosen);
	t.true(
		supervisor
			.getDiagnostics(chosen.id)
			.lines.some(line => line.includes('fixture-marker')),
	);
	t.throws(() => supervisor.getCapturedDiagnostics(randomUUID(), snapshot.id), {
		code: 'NOT_FOUND',
	});
	t.throws(() => supervisor.getDiagnostics(randomUUID()), {code: 'NOT_FOUND'});
});

test('an exited process cannot create a late approval while its failed turn is settling', async t => {
	const clock = new FakeClock();
	let ask: ConnectOptions['onPermission'];
	let release!: () => void;
	const settling = new Promise<void>(resolve => {
		release = resolve;
	});
	let approvals = 0;
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
		connect: async options => {
			ask = options.onPermission;
			const connection = await connectProject(options);
			if ('status' in connection) return connection;
			return {
				...connection,
				prompt: async (id, text) => {
					try {
						return await connection.prompt(id, text);
					} finally {
						await settling;
					}
				},
			};
		},
	});
	t.teardown(async () => {
		release();
		await supervisor.close();
	});
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	await supervisor.getConnection(chosen.id).newSession('normal');
	supervisor.subscribe(event => {
		if (event.type === 'turn' && event.events[0].type === 'permission')
			approvals++;
	});
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	const turn = t.throwsAsync(
		supervisor.prompt(chosen.id, 'fake-session', 'synthetic'),
	);
	await failed;
	if (!ask) throw new Error('Missing permission callback');
	const late = ask({
		sessionId: 'fake-session',
		toolCall: {toolCallId: 'late'},
		options: [{optionId: 'allow', name: 'Allow', kind: 'allow_once'}],
	});
	t.is(approvals, 0);
	release();
	await supervisor.stop(chosen.id);
	await turn;
	t.deepEqual(await late, {outcome: {outcome: 'cancelled'}});
});

test('a failed turn settling after recovery cannot publish an obsolete failed state', async t => {
	const clock = new FakeClock();
	let release!: () => void;
	const settling = new Promise<void>(resolve => {
		release = resolve;
	});
	const states: string[] = [];
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
		connect: async options => {
			const connection = await connectProject(options);
			if ('status' in connection) return connection;
			return {
				...connection,
				prompt: async (id, text) => {
					try {
						return await connection.prompt(id, text);
					} finally {
						await settling;
					}
				},
			};
		},
	});
	t.teardown(async () => {
		release();
		await supervisor.close();
	});
	supervisor.subscribe(event => {
		if (event.type === 'supervisor') states.push(event.state.status);
	});
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	await supervisor.getConnection(chosen.id).newSession('normal');
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	const turn = t.throwsAsync(
		supervisor.prompt(chosen.id, 'fake-session', 'synthetic'),
	);
	await failed;
	const ready = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'ready',
	);
	clock.advance(1000);
	await ready;
	release();
	await turn;
	t.is(states.at(-1), 'ready');
	t.is(supervisor.getState(chosen.id).status, 'ready');
});

test('a pending retry cannot launch over a newer handle for the same canonical root', async t => {
	const clock = new FakeClock();
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	await supervisor.getConnection(chosen.id).newSession('normal');
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	await t.throwsAsync(
		supervisor.prompt(chosen.id, 'fake-session', 'synthetic'),
	);
	await failed;
	const newer = {...chosen, id: randomUUID()};
	await supervisor.ensureProcess(newer);
	const connection = supervisor.getConnection(newer.id);
	t.notThrows(() => clock.advance(1000));
	t.is(supervisor.getState(chosen.id).restart.nextAttemptAt, null);
	t.is(supervisor.getConnection(newer.id), connection);
	t.is(clock.pending, 0);
});

test('diagnostics preserves an omission warning after the source process stops', async t => {
	const supervisor = new ProjectSupervisor({
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	supervisor.getConnection(chosen.id).stderr.write('x'.repeat(5000));
	t.true(supervisor.getDiagnostics(chosen.id).truncated);
	await supervisor.stop(chosen.id);
	t.true(supervisor.getDiagnostics(chosen.id).truncated);
});

test('pre-initialise failure, trust refusal and unsupported versions never schedule automatic launches', async t => {
	for (const mode of ['crash', 'refuse', 'old-version']) {
		const clock = new FakeClock();
		let launches = 0;
		const supervisor = new ProjectSupervisor({
			clock,
			resolveRuntime: async () => {
				launches++;
				return {ok: true, runtime};
			},
			clientInfo: {name: 'test', version: '0'},
			confirmTrust: async () => false,
		});
		t.teardown(() => supervisor.close());
		const chosen = project(mode);
		const state = await supervisor.ensureProcess(chosen);
		t.true(['failed', 'untrusted', 'unsupported'].includes(state.status));
		t.is(state.restart.limit, 0);
		t.is(clock.pending, 0);
		clock.advance(60_000);
		t.is(launches, 1);
	}
});

test('stop and quit cancel scheduled restarts and refuse changed recovery roots', async t => {
	for (const quit of [false, true]) {
		const clock = new FakeClock();
		const supervisor = new ProjectSupervisor({
			clock,
			resolveRuntime: async () => ({ok: true, runtime}),
			clientInfo: {name: 'test', version: '0'},
			confirmTrust: async () => false,
		});
		t.teardown(() => supervisor.close());
		const chosen = project('die-in-turn');
		await supervisor.ensureProcess(chosen);
		await supervisor.getConnection(chosen.id).newSession('normal');
		const failed = next(
			supervisor,
			event => event.type === 'supervisor' && event.state.status === 'failed',
		);
		await t.throwsAsync(
			supervisor.prompt(chosen.id, 'fake-session', 'synthetic'),
		);
		await failed;
		await t.throwsAsync(
			supervisor.restart({...chosen, canonicalRoot: project().canonicalRoot}),
			{code: 'NOT_FOUND'},
		);
		await t.throwsAsync(supervisor.restart({...chosen, id: randomUUID()}), {
			code: 'NOT_FOUND',
		});
		if (quit) await supervisor.close();
		else await supervisor.stop(chosen.id);
		t.is(clock.pending, 0);
		clock.advance(60_000);
		t.is(supervisor.getState(chosen.id).status, 'stopped');
		t.is(supervisor.getState(chosen.id).restart.nextAttemptAt, null);
	}
});

test('missing resume or safe mode leaves recovery unavailable without a new session or prompt', async t => {
	for (const mode of [
		'no-resume',
		'missing-session',
		'mode-fails',
		'no-normal',
	]) {
		const clock = new FakeClock();
		let sessions: TechnicalSessions;
		let latest: NanocoderConnection | undefined;
		const supervisor = new ProjectSupervisor({
			clock,
			resolveRuntime: async () => ({ok: true, runtime}),
			clientInfo: {name: 'test', version: '0'},
			confirmTrust: async () => false,
			recover: (chosen, connection, signal) =>
				sessions.restore(chosen, connection, signal),
			connect: async options => {
				const result = await connectProject(options);
				if (!('status' in result)) latest = result;
				return result;
			},
		});
		sessions = new TechnicalSessions(supervisor, clock);
		t.teardown(() => supervisor.close());
		const chosen = project('die-in-turn');
		await supervisor.ensureProcess(chosen);
		const session = await sessions.prepare(chosen);
		const failed = next(
			supervisor,
			event => event.type === 'supervisor' && event.state.status === 'failed',
		);
		await t.throwsAsync(supervisor.prompt(chosen.id, session.id, 'synthetic'));
		await failed;
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), mode);
		const unavailable = next(
			supervisor,
			event =>
				event.type === 'supervisor' &&
				['failed', 'unsupported'].includes(event.state.status) &&
				event.state.restart.nextAttemptAt === null,
		);
		clock.advance(1000);
		await unavailable;
		t.throws(() => supervisor.getConnection(chosen.id));
		t.is(clock.pending, 0);
		if (!latest) throw new Error('Missing recovered connection');
		const methods = fakeEvents(latest.stderr.lines()).map(
			event => event.method,
		);
		t.false(methods.includes('session/new'));
		t.false(methods.includes('session/prompt'));
		t.is(methods.includes('session/resume'), mode !== 'no-resume');
	}
});

test('recovery remains starting until mode confirmation and detach aborts that preparation', async t => {
	const clock = new FakeClock();
	let sessions: TechnicalSessions;
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
		recover: (chosen, connection, signal) =>
			sessions.restore(chosen, connection, signal),
	});
	sessions = new TechnicalSessions(supervisor, clock);
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	await supervisor.ensureProcess(chosen);
	const session = await sessions.prepare(chosen);
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	await t.throwsAsync(supervisor.prompt(chosen.id, session.id, 'synthetic'));
	await failed;
	writeFileSync(
		path.join(chosen.canonicalRoot, '.fake-nanocoder'),
		'slow-mode',
	);
	const waiting = next(
		supervisor,
		event =>
			event.type === 'turn' &&
			event.events.some(
				event => event.type === 'text' && event.text === 'mode waiting',
			),
	);
	clock.advance(1000);
	await waiting;
	t.is(supervisor.getState(chosen.id).status, 'starting');
	t.throws(() => supervisor.getConnection(chosen.id));
	t.true(sessions.activity(chosen.id).preparing);
	await sessions.detach([chosen]);
	t.is(supervisor.getState(chosen.id).status, 'stopped');
	t.is(clock.pending, 0);
});

test('signal exit records the signal, fails the active turn and cancels its pending approval', async t => {
	const clock = new FakeClock();
	const supervisor = new ProjectSupervisor({
		clock,
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
	});
	const sessions = new TechnicalSessions(supervisor, clock);
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const session = await sessions.prepare(chosen);
	const waiting = next(
		supervisor,
		event => event.type === 'turn' && event.events[0].type === 'permission',
	);
	const turn = t.throwsAsync(
		supervisor.prompt(chosen.id, session.id, 'synthetic'),
	);
	const approval = await waiting;
	t.true(sessions.activity(chosen.id).runningTurn);
	const started = fakeEvents(
		supervisor.getConnection(chosen.id).stderr.lines(),
	).find(event => event.started);
	if (typeof started?.pid !== 'number') throw new Error('Missing fake child');
	const failed = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'failed',
	);
	process.kill(started.pid, 'SIGTERM');
	await failed;
	await turn;
	t.deepEqual(supervisor.getState(chosen.id).exit, {
		code: null,
		signal: 'SIGTERM',
	});
	t.false(sessions.activity(chosen.id).runningTurn);
	if (approval.type !== 'turn' || approval.events[0].type !== 'permission')
		throw new Error('Missing approval');
	t.false(
		supervisor.answerPermission(
			chosen.id,
			session.id,
			approval.events[0].request.id,
			'allow',
		),
	);
});

test('a completed long-running turn starts a fresh full idle period', async t => {
	const clock = new FakeClock();
	let release!: () => void;
	const settled = new Promise<void>(resolve => {
		release = resolve;
	});
	const supervisor = new ProjectSupervisor({
		clock,
		idleTimeoutMs: 1000,
		activity: () => ({
			runningTurn: false,
			openSessions: 0,
			preparing: false,
			lastActivityAt: 0,
		}),
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0'},
		confirmTrust: async () => false,
		connect: async options => {
			const connection = await connectProject(options);
			if ('status' in connection) return connection;
			return {
				...connection,
				prompt: async () => {
					await settled;
					return {stopReason: 'cancelled'};
				},
				cancel: async () => release(),
			};
		},
	});
	t.teardown(() => supervisor.close());
	const chosen = project('permission');
	await supervisor.ensureProcess(chosen);
	const connection = supervisor.getConnection(chosen.id);
	const session = await connection.newSession('normal');
	const prompt = supervisor.prompt(chosen.id, session.id, 'fixture long turn');
	clock.advance(9999);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	await supervisor.cancel(chosen.id, session.id);
	t.is((await prompt).stopReason, 'cancelled');
	clock.advance(1);
	t.is(supervisor.getState(chosen.id).status, 'ready');
	const stopped = next(
		supervisor,
		event => event.type === 'supervisor' && event.state.status === 'stopped',
	);
	clock.advance(999);
	await stopped;
	t.is(supervisor.getState(chosen.id).status, 'stopped');
});

test('idle shutdown closes every advertised loaded session before EOF and skips unsupported close', async t => {
	for (const mode of ['multiple-sessions', 'no-close']) {
		const clock = new FakeClock();
		const supervisor = new ProjectSupervisor({
			clock,
			idleTimeoutMs: 1000,
			activity: () => ({
				runningTurn: false,
				openSessions: 0,
				preparing: false,
				lastActivityAt: 0,
			}),
			resolveRuntime: async () => ({ok: true, runtime}),
			clientInfo: {name: 'test', version: '0'},
			confirmTrust: async () => false,
		});
		t.teardown(() => supervisor.close());
		const chosen = project(mode);
		await supervisor.ensureProcess(chosen);
		const connection = supervisor.getConnection(chosen.id);
		await connection.newSession('normal');
		await connection.newSession('plan');
		const stopped = next(
			supervisor,
			event => event.type === 'supervisor' && event.state.status === 'stopped',
		);
		clock.advance(1000);
		await stopped;
		const events = fakeEvents(connection.stderr.lines());
		const closed = events.filter(event => event.method === 'session/close');
		t.is(closed.length, mode === 'multiple-sessions' ? 2 : 0);
		if (mode === 'multiple-sessions') {
			const eof = events.findIndex(event => event.stdinClosed);
			t.true(eof > 0);
			t.true(
				events.every(
					(event, index) => event.method !== 'session/close' || index < eof,
				),
			);
		}
		t.deepEqual(await connection.exited, {code: 0, signal: null});
	}
});
