import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {TechnicalSessions} from '@/main/nanocoder/technical-sessions';
import type {ProjectInfo} from '@/shared/ipc';

const project = (): ProjectInfo => {
	const root = fakeProject();
	return {
		id: randomUUID(),
		canonicalRoot: root,
		sessionCwd: root,
		displayName: 'fake',
		trusted: true,
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
};
const make = () =>
	new ProjectSupervisor({
		resolveRuntime: async () => ({
			ok: true,
			runtime: {
				...fakeRuntime,
				version: '9.9.9',
				nodeVersion: process.version,
				source: 'override',
			},
		}),
		clientInfo: {name: 'test', version: '0.0.0'},
		confirmTrust: async () => false,
	});
test.after.always(removeFakeProjects);

test('failed cached resumes stop the connection and invalidate readiness before a clean retry', async t => {
	for (const mode of [
		'missing-session',
		'resume-fails',
		'mode-fails',
		'no-normal',
	]) {
		const supervisor = make();
		t.teardown(() => supervisor.close());
		const chosen = project();
		const sessions = new TechnicalSessions(supervisor);
		await supervisor.ensureProcess(chosen);
		const initial = await sessions.prepare(chosen);
		t.deepEqual(await sessions.prepare(chosen), initial);
		await supervisor.stop(chosen.id);
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), mode);
		await supervisor.ensureProcess(chosen);
		const failed = supervisor.getConnection(chosen.id);
		await t.throwsAsync(sessions.prepare(chosen), {
			instanceOf: NanocoderFailure,
		});
		t.is(supervisor.getState(chosen.id).status, 'stopped');
		t.deepEqual(await failed.exited, {code: 0, signal: null});
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), 'ok');
		await supervisor.ensureProcess(chosen);
		const fresh = await sessions.prepare(chosen);
		const cancel = supervisor.subscribe(event => {
			if (event.type === 'turn' && event.events[0].type === 'permission')
				void supervisor.cancel(chosen.id, fresh.id);
		});
		t.deepEqual(await supervisor.prompt(chosen.id, fresh.id, 'retry'), {
			stopReason: 'cancelled',
		});
		cancel();
		t.is(supervisor.getState(chosen.id).activeThreadId, null);
	}
});

test('detaching cancels active and starting projects but preserves idle processes', async t => {
	const supervisor = make();
	const sessions = new TechnicalSessions(supervisor);
	t.teardown(() => supervisor.close());
	const active = project();
	const idle = project();
	const starting = project();
	await supervisor.ensureProcess(active);
	await supervisor.ensureProcess(idle);
	const connection = supervisor.getConnection(active.id);
	const {id} = await connection.newSession('normal');
	let pending!: () => void;
	const permission = new Promise<void>(resolve => {
		pending = resolve;
	});
	supervisor.subscribe(event => {
		if (event.type === 'turn' && event.events[0].type === 'permission')
			pending();
	});
	const turn = supervisor.prompt(active.id, id, 'cancel on detach');
	await permission;
	const start = supervisor.ensureProcess(starting);
	await sessions.detach([active, idle, starting]);
	await start;
	t.deepEqual(await turn, {stopReason: 'cancelled'});
	t.is(supervisor.getState(active.id).status, 'stopped');
	t.is(supervisor.getState(starting.id).status, 'stopped');
	t.is(supervisor.getState(idle.id).status, 'ready');
});

test('detached cleanup awaits every project even if one cleanup fails', async t => {
	const supervisor = make();
	const sessions = new TechnicalSessions(supervisor);
	const projects = [project(), project()];
	const pending = projects.map(chosen => supervisor.ensureProcess(chosen));
	const stop = supervisor.stop.bind(supervisor);
	t.teardown(() => {
		supervisor.stop = stop;
		return supervisor.close();
	});
	const stopped: string[] = [];
	supervisor.stop = async id => {
		const state = await stop(id);
		stopped.push(id);
		if (id === projects[0].id) throw new Error('fake cleanup failure');
		return state;
	};
	await sessions.detach(projects);
	await Promise.all(pending);
	supervisor.stop = stop;
	t.is(stopped.length, 2);
	for (const chosen of projects)
		t.is(supervisor.getState(chosen.id).status, 'stopped');
});

test('detaching owns new, resume and mode preparation until every request settles', async t => {
	for (const [mode, resume] of [
		['slow-new', false],
		['slow-mode', false],
		['slow-resume', true],
		['slow-mode', true],
	] as const) {
		const supervisor = make();
		t.teardown(() => supervisor.close());
		const sessions = new TechnicalSessions(supervisor);
		const chosen = project();
		await supervisor.ensureProcess(chosen);
		if (resume) await sessions.prepare(chosen);
		await supervisor.stop(chosen.id);
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), mode);
		await supervisor.ensureProcess(chosen);
		const connection = supervisor.getConnection(chosen.id);
		let reached!: () => void;
		const waiting = new Promise<void>(resolve => {
			reached = resolve;
		});
		const unsubscribe = supervisor.subscribe(event => {
			if (
				event.type === 'turn' &&
				event.events.some(
					item => item.type === 'text' && item.text.includes('waiting'),
				)
			)
				reached();
		});
		if (mode === 'slow-resume') {
			const resumeSession = connection.resumeSession;
			connection.resumeSession = (...args) => {
				const pending = resumeSession(...args);
				reached();
				return pending;
			};
		}
		const abort = new AbortController();
		const preparing = sessions.prepare(chosen, abort.signal);
		t.is(sessions.prepare(chosen, abort.signal), preparing);
		const rejected = t.throwsAsync(preparing, {instanceOf: Error});
		await waiting;
		t.is(supervisor.getState(chosen.id).status, 'ready');
		t.is(supervisor.getState(chosen.id).activeThreadId, null);
		await t.throwsAsync(connection.prompt('fake-session', 'not ready'), {
			message: /until its mode is set/,
		});
		abort.abort();
		await sessions.detach([]);
		await rejected;
		unsubscribe();
		t.is(supervisor.getState(chosen.id).status, 'stopped');
		t.deepEqual(await connection.exited, {code: 0, signal: null});
		t.false(
			fakeEvents(connection.stderr.lines()).some(
				event => event.method === 'session/prompt',
			),
		);
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), 'ok');
		await supervisor.ensureProcess(chosen);
		await sessions.prepare(chosen);
		await sessions.detach([chosen]);
		t.is(supervisor.getState(chosen.id).status, 'ready');
	}
});

test('an already-aborted attachment cannot begin session preparation', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const sessions = new TechnicalSessions(supervisor);
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const abort = new AbortController();
	abort.abort(new Error('detached'));
	t.throws(() => sessions.prepare(chosen, abort.signal), {message: 'detached'});
	await sessions.prepare(chosen);
	await sessions.detach([chosen]);
	t.is(supervisor.getState(chosen.id).status, 'ready');
});

test('late mode answers cannot restore a cancelled or replaced preparation', async t => {
	for (const cancelled of [true, false]) {
		const supervisor = make();
		t.teardown(() => supervisor.close());
		const sessions = new TechnicalSessions(supervisor);
		const chosen = project();
		await supervisor.ensureProcess(chosen);
		const connection = supervisor.getConnection(chosen.id);
		const prepare = connection.newSession;
		let release!: () => void;
		const gated = new Promise<void>(resolve => {
			release = resolve;
		});
		let reached!: () => void;
		const entered = new Promise<void>(resolve => {
			reached = resolve;
		});
		connection.newSession = async mode => {
			const session = await prepare(mode);
			reached();
			await gated;
			return session;
		};
		const abort = new AbortController();
		const pending = sessions.prepare(chosen, abort.signal);
		const rejected = t.throwsAsync(pending);
		await entered;
		if (cancelled) abort.abort(new Error('detached'));
		else {
			await supervisor.stop(chosen.id);
			await supervisor.ensureProcess(chosen);
		}
		const detached = cancelled ? sessions.detach([]) : Promise.resolve();
		release();
		await detached;
		await rejected;
		t.is(supervisor.getState(chosen.id).status, 'stopped');
		await supervisor.ensureProcess(chosen);
		await sessions.prepare(chosen);
		t.is(supervisor.getState(chosen.id).status, 'ready');
	}
});
