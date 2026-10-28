import {randomUUID} from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	type ConnectOptions,
	connectNanocoder,
} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {connectProject} from '@/main/nanocoder/open-project';
import {type Resolution, resolveNanocoder} from '@/main/nanocoder/runtime';
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

test('a reentrant starting subscriber shares ownership and all children exit on close', async t => {
	const chosen = project();
	let lookups = 0;
	const connections: Awaited<ReturnType<typeof connectNanocoder>>[] = [];
	const supervisor = make({
		resolveRuntime: async () => {
			lookups++;
			return {ok: true, runtime};
		},
		connect: async options => {
			const connection = await connectProject(options);
			if (!('status' in connection)) connections.push(connection);
			return connection;
		},
	});
	t.teardown(() => supervisor.close());
	let nested: Promise<unknown> | undefined;
	supervisor.subscribe(event => {
		if (
			event.type === 'supervisor' &&
			event.state.status === 'starting' &&
			!nested
		)
			nested = supervisor.ensureProcess(chosen);
	});
	const start = supervisor.ensureProcess(chosen);
	t.is(nested, start);
	await start;
	t.is(lookups, 1);
	t.is(connections.length, 1);
	await supervisor.close();
	t.deepEqual(await connections[0].exited, {code: 0, signal: null});
});

test('shutdown from the starting publication owns and aborts the registered start', async t => {
	const chosen = project();
	let lookups = 0;
	const supervisor = make({
		resolveRuntime: async () => {
			lookups++;
			return {ok: true, runtime};
		},
	});
	let closing: Promise<void> | undefined;
	supervisor.subscribe(event => {
		if (event.type === 'supervisor' && event.state.status === 'starting')
			closing = supervisor.close();
	});
	await supervisor.ensureProcess(chosen);
	await closing;
	t.is(lookups, 0);
	t.is(supervisor.getState(chosen.id).status, 'stopped');
	t.throws(() => supervisor.ensureProcess(project()), {instanceOf: IpcFailure});
});

test('cancellation rejects late permissions until the turn settles and allows a new turn', async t => {
	const outcomes: string[] = [];
	const supervisor = make({
		connect: options =>
			connectProject({
				...options,
				onPermission: async request => {
					const response = await options.onPermission?.(request);
					if (!response) throw new Error('Missing permission handler');
					outcomes.push(response.outcome.outcome);
					return response;
				},
			}),
	});
	t.teardown(() => supervisor.close());
	const chosen = project('two-tools');
	await supervisor.ensureProcess(chosen);
	const connection = supervisor.getConnection(chosen.id);
	const {id} = await connection.newSession('normal');
	let approvals = 0;
	let cancelled: Promise<void> | undefined;
	const unsubscribe = supervisor.subscribe(event => {
		if (event.type === 'turn' && event.events[0].type === 'permission') {
			approvals++;
			if (approvals === 1) cancelled = supervisor.cancel(chosen.id, id);
		}
	});
	t.deepEqual(await supervisor.prompt(chosen.id, id, 'cancel both'), {
		stopReason: 'cancelled',
	});
	await cancelled;
	unsubscribe();
	t.is(approvals, 1);
	t.is(supervisor.getState(chosen.id).activeThreadId, null);
	t.deepEqual(outcomes, ['cancelled', 'cancelled']);
	const next = nextEvent(
		supervisor,
		event => event.type === 'turn' && event.events[0].type === 'permission',
	);
	const following = supervisor.prompt(chosen.id, id, 'next turn');
	await next;
	await supervisor.cancel(chosen.id, id);
	t.deepEqual(await following, {stopReason: 'cancelled'});
});

test('permissions outside the active session are cancelled instead of becoming hidden approvals', async t => {
	let request: ConnectOptions['onPermission'];
	let approvals = 0;
	const supervisor = make({
		connect: options => {
			request = options.onPermission;
			return connectProject(options);
		},
	});
	t.teardown(() => supervisor.close());
	const chosen = project();
	supervisor.subscribe(event => {
		if (event.type === 'turn' && event.events[0].type === 'permission')
			approvals++;
	});
	await supervisor.ensureProcess(chosen);
	const ask = request;
	if (!ask) throw new Error('Missing permission handler');
	const permission = {
		sessionId: 'other-session',
		toolCall: {toolCallId: 'other'},
		options: [{optionId: 'allow', name: 'Allow', kind: 'allow_once' as const}],
	};
	t.deepEqual(await ask(permission), {outcome: {outcome: 'cancelled'}});
	const {id} = await supervisor.getConnection(chosen.id).newSession('normal');
	const waiting = nextEvent(
		supervisor,
		event => event.type === 'turn' && event.events[0].type === 'permission',
	);
	const turn = supervisor.prompt(chosen.id, id, 'live');
	await waiting;
	t.deepEqual(await ask(permission), {outcome: {outcome: 'cancelled'}});
	t.is(approvals, 1);
	await supervisor.cancel(chosen.id, id);
	await turn;
});

test('cancellation from the active-state publication prevents the prompt entirely', async t => {
	const supervisor = make();
	t.teardown(() => supervisor.close());
	const chosen = project();
	await supervisor.ensureProcess(chosen);
	const connection = supervisor.getConnection(chosen.id);
	const {id} = await connection.newSession('normal');
	let cancelled: Promise<void> | undefined;
	supervisor.subscribe(event => {
		if (
			event.type === 'supervisor' &&
			event.state.activeThreadId === id &&
			!cancelled
		)
			cancelled = supervisor.cancel(chosen.id, id);
	});
	t.deepEqual(await supervisor.prompt(chosen.id, id, 'not sent'), {
		stopReason: 'cancelled',
	});
	await cancelled;
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/prompt',
		),
	);
	t.is(supervisor.getState(chosen.id).activeThreadId, null);
});

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
	'pre-trust launch rechecks CLI and Node links into the project',
	async t => {
		for (const which of ['cli', 'node']) {
			const chosen = {...project(), trusted: false};
			const target = path.join(chosen.canonicalRoot, '..tools', which);
			mkdirSync(path.dirname(target), {recursive: true});
			writeFileSync(target, '');
			const link = path.join(fakeProject(), 'runtime-link');
			symlinkSync(target, link);
			let confirmations = 0;
			const supervisor = make({
				resolveRuntime: async () => ({
					ok: true,
					runtime: {
						...runtime,
						...(which === 'cli' ? {cliPath: link} : {nodePath: link}),
					},
				}),
				confirmTrust: async () => {
					confirmations++;
					return true;
				},
			});
			t.teardown(() => supervisor.close());
			const state = await supervisor.probeProject(chosen);
			t.is(state.status, 'failed', which);
			t.regex(state.reason ?? '', /runtime changed or is inside/);
			t.is(confirmations, 0);
			t.throws(() => supervisor.getConnection(chosen.id), {
				instanceOf: IpcFailure,
			});
		}
	},
);

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

test('an untrusted project probe refuses exact ..tools override paths before any launch', async t => {
	for (const which of ['cli', 'node']) {
		const chosen = {...project(), trusted: false};
		const tools = path.join(chosen.canonicalRoot, '..tools');
		const [cli, externalCli] = [
			path.join(tools, 'nanocoder'),
			fakeProject(),
		].map(base => {
			const file = path.join(base, 'dist', 'cli.js');
			mkdirSync(path.dirname(file), {recursive: true});
			writeFileSync(
				path.join(base, 'package.json'),
				JSON.stringify({
					name: '@nanocollective/nanocoder',
					version: '9.9.9',
					type: 'module',
					bin: {nanocoder: 'dist/cli.js'},
				}),
			);
			copyFileSync(fakeRuntime.cliPath, file);
			return file;
		});
		const node = path.join(tools, 'node');
		writeFileSync(node, '');
		chmodSync(node, 0o755);
		let launches = 0;
		let confirmations = 0;
		let probed = false;
		const supervisor = make({
			resolveRuntime: (root, signal) =>
				resolveNanocoder({
					env: {
						NANOCODER_DESKTOP_CLI: which === 'cli' ? cli : externalCli,
						NANOCODER_DESKTOP_NODE: which === 'node' ? node : process.execPath,
					},
					platform: process.platform,
					untrustedRoots: [root],
					signal,
					readNodeVersion: async () => {
						probed = true;
						return 'v24.0.0';
					},
				}),
			connect: async options => {
				launches++;
				return connectProject(options);
			},
			confirmTrust: async () => {
				confirmations++;
				return true;
			},
		});
		t.teardown(() => supervisor.close());
		const state = await supervisor.probeProject(chosen);
		t.is(state.status, 'failed', which);
		t.regex(state.reason ?? '', /inside the project folder/);
		t.is(launches, 0);
		t.is(confirmations, 0);
		t.false(probed);
		t.throws(() => supervisor.getConnection(chosen.id), {
			instanceOf: IpcFailure,
		});
	}
});

test('the pre-launch guard independently rejects ..tools runtimes from an injected resolver', async t => {
	for (const which of ['cli', 'node']) {
		const chosen = {...project(), trusted: false};
		const file = path.join(
			chosen.canonicalRoot,
			'..tools',
			which === 'cli' ? 'nanocoder/dist/cli.js' : 'node',
		);
		mkdirSync(path.dirname(file), {recursive: true});
		writeFileSync(file, '');
		let launches = 0;
		let confirmations = 0;
		const supervisor = make({
			resolveRuntime: async () => ({
				ok: true,
				runtime: {
					...runtime,
					...(which === 'cli' ? {cliPath: file} : {nodePath: file}),
				},
			}),
			connect: async options => {
				await options.beforeLaunch?.();
				launches++;
				return connectProject(options);
			},
			confirmTrust: async () => {
				confirmations++;
				return true;
			},
		});
		t.teardown(() => supervisor.close());
		const state = await supervisor.probeProject(chosen);
		t.is(state.status, 'failed', which);
		t.regex(state.reason ?? '', /runtime changed or is inside/);
		t.is(launches, 0);
		t.is(confirmations, 0);
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
