import {randomUUID} from 'node:crypto';
import {existsSync, renameSync, symlinkSync} from 'node:fs';
import test from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {connectProject} from '@/main/nanocoder/open-project';
import type {Resolution} from '@/main/nanocoder/runtime';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import type {ProjectEvent, ProjectInfo} from '@/shared/ipc';

const runtime = {
	...fakeRuntime,
	version: '9.9.9',
	nodeVersion: process.version,
	source: 'override' as const,
};
const project = (mode?: string): ProjectInfo => {
	const root = fakeProject(mode);
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
const make = (
	options: Partial<ConstructorParameters<typeof ProjectSupervisor>[0]> = {},
) =>
	new ProjectSupervisor({
		resolveRuntime: async () => ({ok: true, runtime}),
		clientInfo: {name: 'test', version: '0.0.0'},
		confirmTrust: async () => false,
		...options,
	});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function nextEvent(
	supervisor: ProjectSupervisor,
	matches: (event: ProjectEvent) => boolean,
) {
	return new Promise<ProjectEvent>(resolve => {
		const unsubscribe = supervisor.subscribe(event => {
			if (!matches(event)) return;
			unsubscribe();
			resolve(event);
		});
	});
}

test.after.always(removeFakeProjects);

test('coalesces simultaneous starts for one project at its canonical root', async t => {
	const roots: string[] = [];
	const supervisor = make({
		resolveRuntime: async root => {
			roots.push(root);
			return {ok: true, runtime};
		},
	});
	t.teardown(() => supervisor.close());
	const chosen = project();
	const [first, second] = await Promise.all([
		supervisor.ensureProcess(chosen),
		supervisor.ensureProcess(chosen),
	]);
	t.is(first.status, 'ready');
	t.deepEqual(first, second);
	t.deepEqual(roots, [chosen.canonicalRoot]);
	const connection = supervisor.getConnection(chosen.id);
	t.is(
		fakeEvents(connection.stderr.lines()).find(event => event.started)?.cwd,
		chosen.canonicalRoot,
	);
	t.is((await supervisor.ensureProcess(chosen)).status, 'ready');
	t.is(supervisor.getConnection(chosen.id), connection);
	t.throws(
		() => supervisor.ensureProcess({...chosen, canonicalRoot: fakeProject()}),
		{instanceOf: IpcFailure},
	);
	t.throws(() => supervisor.ensureProcess({...chosen, id: randomUUID()}), {
		instanceOf: IpcFailure,
	});
});

test('runs two processes concurrently and isolates turn events, approvals and cancellation', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const projects = [project(), project()];
	const events: ProjectEvent[] = [];
	supervisor.subscribe(event => events.push(event));
	await Promise.all(projects.map(p => supervisor.ensureProcess(p)));
	const [a, b] = projects;
	const ca = supervisor.getConnection(a.id);
	const cb = supervisor.getConnection(b.id);
	t.not(ca, cb);
	await Promise.all([ca.newSession('normal'), cb.newSession('normal')]);
	const waiting = projects.map(p =>
		nextEvent(
			supervisor,
			event =>
				event.type === 'turn' &&
				event.projectId === p.id &&
				event.events[0].type === 'permission',
		),
	);
	const turns = projects.map(p =>
		supervisor.prompt(p.id, 'fake-session', 'fake request'),
	);
	const approvals = await Promise.all(waiting);
	await t.throwsAsync(supervisor.prompt(a.id, 'fake-session', 'overlap'), {
		instanceOf: IpcFailure,
	});
	for (const event of approvals) {
		if (event.type !== 'turn' || event.events[0].type !== 'permission')
			throw new Error('Expected permission');
		const request = event.events[0].request;
		t.false(
			supervisor.answerPermission(
				event.projectId === a.id ? b.id : a.id,
				event.threadId,
				request.id,
				'allow',
			),
		);
		t.false(
			supervisor.answerPermission(
				event.projectId,
				'other-session',
				request.id,
				'allow',
			),
		);
		t.false(
			supervisor.answerPermission(
				event.projectId,
				event.threadId,
				request.id,
				'unoffered',
			),
		);
		if (event.projectId === a.id)
			t.true(
				supervisor.answerPermission(a.id, event.threadId, request.id, 'allow'),
			);
	}
	await supervisor.cancel(b.id, 'fake-session');
	t.deepEqual(await Promise.all(turns), [
		{stopReason: 'end_turn'},
		{stopReason: 'cancelled'},
	]);
	for (const p of projects) {
		const turns = events.filter(e => e.type === 'turn' && e.projectId === p.id);
		t.deepEqual(
			turns.map(e => e.sequence),
			turns.map((_, i) => i + 1),
		);
		const changes = events.filter(
			e => e.type !== 'turn' && e.projectId === p.id,
		);
		t.deepEqual(
			changes.map(e => e.sequence),
			changes.map((_, i) => i + 1),
		);
	}
	await supervisor.stop(a.id);
	t.is(supervisor.getState(b.id).status, 'ready');
	t.is(supervisor.getState(a.id).status, 'stopped');
});

test('refuses untrusted metadata and roots that are missing, relative or changed', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const chosen = project();
	t.throws(() => supervisor.ensureProcess({...chosen, trusted: false}), {
		instanceOf: IpcFailure,
	});
	t.throws(
		() => supervisor.ensureProcess({...chosen, availability: 'missing'}),
		{instanceOf: IpcFailure},
	);
	t.throws(
		() => supervisor.ensureProcess({...chosen, canonicalRoot: 'relative'}),
		{instanceOf: IpcFailure},
	);
	const state = await supervisor.ensureProcess({
		...chosen,
		sessionCwd: fakeProject(),
	});
	t.is(state.status, 'failed');
	t.regex(state.reason ?? '', /canonical project root changed/);
	t.throws(() => supervisor.getConnection(chosen.id), {instanceOf: IpcFailure});
});

const symlinkTest = process.platform === 'win32' ? test.skip : test;
symlinkTest(
	'refuses a saved canonical root that now resolves through a link',
	async t => {
		const supervisor = make();
		t.teardown(() => supervisor.close());
		const chosen = project();
		const link = `${fakeProject()}/linked`;
		symlinkSync(chosen.canonicalRoot, link, 'dir');
		const state = await supervisor.ensureProcess({
			...chosen,
			canonicalRoot: link,
			sessionCwd: link,
		});
		t.is(state.status, 'failed');
		t.regex(state.reason ?? '', /canonical project root changed/);
	},
);

test('refuses old package versions before any process or trust launch', async t => {
	let starts = 0;
	const supervisor = make({
		resolveRuntime: async () => ({
			ok: true,
			runtime: {...runtime, version: '1.31.0'},
		}),
		connect: async () => {
			starts++;
			throw new Error('Must not launch');
		},
	});
	t.teardown(() => supervisor.close());
	const chosen = project();
	const state = await supervisor.ensureProcess(chosen);
	t.is(state.status, 'unsupported');
	t.regex(state.reason ?? '', /below the minimum 1.32.0/);
	t.is(starts, 0);
	t.true(
		Object.values(supervisor.getCapabilityGates(chosen.id).features).every(
			g => !g.enabled && !!g.reason,
		),
	);
});

test('checks initialize version even when package metadata claims a newer version', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const chosen = project('old-version');
	const state = await supervisor.ensureProcess(chosen);
	t.is(state.status, 'unsupported');
	t.regex(state.reason ?? '', /Nanocoder 1.31.0 is below/);
	t.is(state.agent?.version, '1.31.0');
	t.throws(() => supervisor.getConnection(chosen.id), {instanceOf: IpcFailure});
});

test('records runtime resolution failures without exposing unexpected error details', async t => {
	for (const resolveRuntime of [
		async (): Promise<Resolution> => ({
			ok: false,
			code: 'DENIED',
			message: 'Refusing a Nanocoder inside the project folder',
		}),
		async (): Promise<Resolution> => {
			throw new Error('secret');
		},
	]) {
		const supervisor = make({resolveRuntime});
		const chosen = project();
		const state = await supervisor.ensureProcess(chosen);
		t.is(state.status, 'failed');
		t.false(state.reason?.includes('secret'));
		await supervisor.close();
	}
});

test('trust refusal never restarts automatically and cancellation never grants trust', async t => {
	let starts = 0;
	let confirmations = 0;
	const supervisor = make({
		connect: options => {
			starts++;
			return connectProject(options);
		},
		confirmTrust: async () => {
			confirmations++;
			return false;
		},
		env: {...process.env, NANOCODER_TRUST_DIRECTORY: '1'},
	});
	t.teardown(() => supervisor.close());
	const chosen = project('untrusted');
	t.is(
		(await supervisor.probeProject({...chosen, trusted: false})).status,
		'untrusted',
	);
	await new Promise(resolve => setImmediate(resolve));
	t.is(starts, 1);
	t.is(confirmations, 1);
	t.is(supervisor.getState(chosen.id).restart.limit, 0);
});

test('quit aborts a pending runtime lookup and never launches its late result', async t => {
	const resolution = deferred<Resolution>();
	const entered = deferred<void>();
	let starts = 0;
	let lookupSignal: AbortSignal | undefined;
	const supervisor = make({
		resolveRuntime: (_root, signal) => {
			lookupSignal = signal;
			entered.resolve();
			return resolution.promise;
		},
		connect: async () => {
			starts++;
			throw new Error('Must not launch');
		},
	});
	const chosen = project();
	const start = supervisor.ensureProcess(chosen);
	await entered.promise;
	await supervisor.close();
	t.true(lookupSignal?.aborted);
	resolution.resolve({ok: true, runtime});
	await start;
	t.is(starts, 0);
	t.is(supervisor.getState(chosen.id).status, 'stopped');
	t.throws(() => supervisor.ensureProcess(project()), {instanceOf: IpcFailure});
});

test('quit aborts initialize and waits for the child to exit', async t => {
	const entered = deferred<void>();
	let connectionEnded = false;
	const supervisor = make({
		connect: async options => {
			entered.resolve();
			try {
				return await connectProject({
					...options,
					initializeTimeoutMs: 60_000,
					shutdownGraceMs: 30,
				});
			} finally {
				connectionEnded = true;
			}
		},
	});
	const chosen = project('silent');
	const start = supervisor.ensureProcess(chosen);
	await entered.promise;
	await supervisor.close();
	await start;
	t.true(connectionEnded);
	t.is(supervisor.getState(chosen.id).status, 'stopped');
});

test('quit while a trust dialog is pending prevents a late trust grant', async t => {
	const confirmation = deferred<boolean>();
	const entered = deferred<void>();
	const supervisor = make({
		confirmTrust: () => {
			entered.resolve();
			return confirmation.promise;
		},
	});
	const chosen = project('untrusted');
	const start = supervisor.probeProject(chosen);
	await entered.promise;
	await supervisor.close();
	confirmation.resolve(true);
	await start;
	t.is(supervisor.getState(chosen.id).status, 'stopped');
});

test('stop coalesces, refuses a concurrent start and permits an explicit later start', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const stopped = supervisor.stop(chosen.id);
	t.is(supervisor.stop(chosen.id), stopped);
	t.throws(() => supervisor.ensureProcess(chosen), {instanceOf: IpcFailure});
	await stopped;
	t.is((await supervisor.ensureProcess(chosen)).status, 'ready');
});

test('shutdown cancels waiting approvals and closes every project before returning', async t => {
	const supervisor = make();
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const connection = supervisor.getConnection(chosen.id);
	await connection.newSession('normal');
	const waiting = nextEvent(
		supervisor,
		e => e.type === 'turn' && e.events[0].type === 'permission',
	);
	const turn = supervisor.prompt(chosen.id, 'fake-session', 'fake');
	await waiting;
	await supervisor.close();
	await turn.catch(() => {});
	t.deepEqual(await connection.exited, {code: 0, signal: null});
	t.is(supervisor.getState(chosen.id).status, 'stopped');
	t.is(supervisor.close(), supervisor.close());
});

test('exit is reported without restart and subscription/state copies stay isolated', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const chosen = project('die-in-turn');
	let updates = 0;
	const unsubscribe = supervisor.subscribe(() => {
		updates++;
	});
	await supervisor.ensureProcess(chosen);
	const copy = supervisor.getState(chosen.id);
	copy.status = 'stopped';
	t.is(supervisor.getState(chosen.id).status, 'ready');
	const connection = supervisor.getConnection(chosen.id);
	await connection.newSession('normal');
	const failed = nextEvent(
		supervisor,
		e => e.type === 'supervisor' && e.state.status === 'failed',
	);
	await t.throwsAsync(supervisor.prompt(chosen.id, 'fake-session', 'fake'));
	await failed;
	t.is(supervisor.getState(chosen.id).exit?.code, 3);
	unsubscribe();
	const before = updates;
	await supervisor.stop(chosen.id);
	t.is(updates, before);
	t.is(supervisor.getState('unknown').status, 'stopped');
	t.is((await supervisor.stop('unknown')).status, 'stopped');
	t.throws(() => supervisor.restart(chosen), {instanceOf: IpcFailure});
	t.throws(() => supervisor.getDiagnostics(chosen.id), {
		instanceOf: IpcFailure,
	});
	t.throws(() => supervisor.getCapabilityGates('unknown'), {
		instanceOf: IpcFailure,
	});
});

test('bounded shutdown kills a process which ignores EOF and termination', async t => {
	const connection = await connectNanocoder({
		runtime,
		root: fakeProject('ignore-shutdown'),
		clientInfo: {name: 'test', version: '0.0.0'},
		shutdownGraceMs: 30,
	});
	await connection.close();
	const exit = await connection.exited;
	t.true(exit.signal === 'SIGKILL' || process.platform === 'win32');
});

symlinkTest(
	'rechecks the canonical root after a pending runtime lookup',
	async t => {
		const chosen = project();
		let launches = 0;
		const supervisor = make({
			resolveRuntime: async () => {
				renameSync(chosen.canonicalRoot, `${fakeProject()}/previous`);
				symlinkSync(fakeProject(), chosen.canonicalRoot, 'dir');
				return {ok: true, runtime};
			},
			connect: async options => {
				await options.beforeLaunch?.();
				launches++;
				return connectProject(options);
			},
		});
		t.teardown(() => supervisor.close());
		t.is((await supervisor.ensureProcess(chosen)).status, 'failed');
		t.is(launches, 0);
	},
);

symlinkTest(
	'a folder swap during the trust dialog cannot grant trust to its replacement',
	async t => {
		const chosen = project('untrusted');
		const replacement = fakeProject('untrusted');
		const supervisor = make({
			confirmTrust: async () => {
				renameSync(chosen.canonicalRoot, `${fakeProject()}/previous`);
				symlinkSync(replacement, chosen.canonicalRoot, 'dir');
				return true;
			},
		});
		t.teardown(() => supervisor.close());
		const state = await supervisor.probeProject(chosen);
		t.is(state.status, 'failed');
		t.false(existsSync(`${replacement}/.fake-trusted`));
		t.regex(state.reason ?? '', /canonical project root changed/);
	},
);

test('a cleanup failure waits for all other project cleanup before rejecting', async t => {
	const supervisor = make();
	const a = project();
	const b = project();
	await Promise.all([supervisor.ensureProcess(a), supervisor.ensureProcess(b)]);
	const ca = supervisor.getConnection(a.id);
	const cb = supervisor.getConnection(b.id);
	const closeA = ca.close;
	const closeB = cb.close;
	const release = deferred<void>();
	const entered = deferred<void>();
	ca.close = async () => {
		await closeA();
		throw new Error('fake cleanup failure');
	};
	cb.close = async () => {
		entered.resolve();
		await release.promise;
		await closeB();
	};
	let settled = false;
	const closing = supervisor.close().finally(() => {
		settled = true;
	});
	const rejection = t.throwsAsync(closing, {instanceOf: AggregateError});
	await entered.promise;
	await new Promise(resolve => setImmediate(resolve));
	t.false(settled);
	release.resolve();
	await rejection;
	t.deepEqual(await cb.exited, {code: 0, signal: null});
});
