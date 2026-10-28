import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {
	prepareSession,
	stopDetachedTurns,
} from '@/main/nanocoder/technical-sessions';
import type {ProjectInfo, SessionInfo} from '@/shared/ipc';

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
		const sessions = new Map<string, SessionInfo>();
		await supervisor.ensureProcess(chosen);
		const initial = await prepareSession(supervisor, chosen, sessions, false);
		t.deepEqual(
			await prepareSession(supervisor, chosen, sessions, true),
			initial,
		);
		await supervisor.stop(chosen.id);
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), mode);
		await supervisor.ensureProcess(chosen);
		const failed = supervisor.getConnection(chosen.id);
		await t.throwsAsync(prepareSession(supervisor, chosen, sessions, false), {
			instanceOf: NanocoderFailure,
		});
		t.false(sessions.has(chosen.id));
		t.is(supervisor.getState(chosen.id).status, 'stopped');
		t.deepEqual(await failed.exited, {code: 0, signal: null});
		writeFileSync(path.join(chosen.canonicalRoot, '.fake-nanocoder'), 'ok');
		await supervisor.ensureProcess(chosen);
		const fresh = await prepareSession(supervisor, chosen, sessions, false);
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
	await stopDetachedTurns(supervisor, [active, idle, starting]);
	await start;
	t.deepEqual(await turn, {stopReason: 'cancelled'});
	t.is(supervisor.getState(active.id).status, 'stopped');
	t.is(supervisor.getState(starting.id).status, 'stopped');
	t.is(supervisor.getState(idle.id).status, 'ready');
});

test('detached cleanup awaits every project even if one cleanup fails', async t => {
	const supervisor = make();
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
	await t.throwsAsync(stopDetachedTurns(supervisor, projects), {
		instanceOf: AggregateError,
	});
	await Promise.all(pending);
	supervisor.stop = stop;
	t.is(stopped.length, 2);
	for (const chosen of projects)
		t.is(supervisor.getState(chosen.id).status, 'stopped');
});
