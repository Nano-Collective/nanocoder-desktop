import test from 'ava';
import {createProjectControls} from '@/main/controls/project-controls';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {
	NanocoderConnection,
	SessionOffers,
} from '@/main/nanocoder/acp-client';
import {createProjectOperations} from '@/main/threads/project-operations';
import type {ProjectControls, ProjectInfo, ThreadInfo} from '@/shared/ipc';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function fixture() {
	const project: ProjectInfo = {
		id: 'project',
		canonicalRoot: '/fixture',
		sessionCwd: '/fixture',
		displayName: 'fixture',
		trusted: true,
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
	const thread: ThreadInfo = {
		id: 'thread',
		projectId: project.id,
		sessionCwd: '/fixture',
		nanocoderSessionId: 'session',
		title: 'fixture',
		archiveState: 'active',
		runState: 'ready',
		lastActivityAt: '',
		mode: 'normal',
		viewOnlyReason: null,
	};
	const projects = new Map([[project.id, project]]);
	const threads = new Map([[thread.id, thread]]);
	let offers: SessionOffers = {
		offeredModes: ['normal', 'plan', 'yolo'],
		configOptions: [
			{
				id: 'provider',
				name: 'provider',
				currentValue: 'a',
				options: [
					{name: 'a', value: 'a'},
					{name: 'b', value: 'b'},
				],
			},
			{
				id: 'model',
				name: 'model',
				currentValue: 'old',
				options: [
					{name: 'old', value: 'old'},
					{name: 'confirmed', value: 'confirmed'},
				],
			},
		],
	};
	const calls: unknown[][] = [];
	let mutate = async (): Promise<SessionOffers> => {
		const next = structuredClone(offers);
		if (next.configOptions?.[0]) next.configOptions[0].currentValue = 'b';
		if (next.configOptions?.[1])
			next.configOptions[1].currentValue = 'confirmed';
		offers = next;
		return structuredClone(next);
	};
	const connection = {
		agent: {root: '/fixture'},
		getSessionOffers: () => structuredClone(offers),
		setConfigOption: (sessionId: string, id: string, value: string) => {
			calls.push([sessionId, id, value]);
			return mutate();
		},
	} as unknown as NanocoderConnection;
	const connections = new Map<string, object>([[project.id, connection]]);
	const operations = createProjectOperations({
		getProject: id => projects.get(id),
		getThread: (projectId, id) => {
			const row = threads.get(id);
			return row?.projectId === projectId ? row : undefined;
		},
		getConnection: id => connections.get(id),
	});
	const published: ProjectControls[] = [];
	const admissions: string[] = [];
	let canonicalise = async (path: string) => path;
	const controls = createProjectControls({
		operations,
		runProjectOperation: (projectId, kind, work, scope) => {
			admissions.push(kind);
			return operations.runProjectOperation(projectId, kind, work, scope);
		},
		getProject: id => projects.get(id),
		getThread: (projectId, id) => {
			const row = threads.get(id);
			return row?.projectId === projectId ? row : undefined;
		},
		getConnection: id => connections.get(id),
		publishControls: snapshot => published.push(snapshot),
		canonicalise: path => canonicalise(path),
	});
	const observe = (row = thread) =>
		operations.runProjectOperation(project.id, 'prepare', async lease => {
			await operations.runOwnedStep(lease, async () => {
				controls.onSessionPrepared({
					lease,
					thread: row,
					connection,
					session: {id: row.nanocoderSessionId ?? '', mode: 'normal'},
					source: 'new',
				});
			});
		});
	const request = (value = 'b') => ({
		projectId: project.id,
		revision: controls.getProjectControls({projectId: project.id}).revision,
		configId: 'provider' as const,
		value,
	});
	return {
		project,
		thread,
		projects,
		threads,
		connections,
		connection,
		operations,
		controls,
		calls,
		published,
		admissions,
		observe,
		request,
		canonicalise: (next: typeof canonicalise) => {
			canonicalise = next;
		},
		mutate: (next: typeof mutate) => {
			mutate = next;
		},
		offers: (next: SessionOffers) => {
			offers = next;
		},
	};
}

test('get controls is side-effect free and has no model catalogue before a first session (CHAT-04)', t => {
	const f = fixture();
	const snapshot = f.controls.getProjectControls({projectId: 'project'});
	t.is(snapshot.projectId, 'project');
	t.regex(snapshot.revision, /^[0-9a-f-]{36}$/);
	t.deepEqual(snapshot.configOptions, []);
	t.false(snapshot.modelGate.enabled);
	t.true(
		snapshot.modelGate.reason?.includes('available after the first message'),
	);
	t.deepEqual(f.calls, []);
	t.deepEqual(f.published, []);
});

test('existing owned session offers are project-wide, cloned and independent of selected thread (CHAT-10)', async t => {
	const f = fixture();
	await f.observe();
	const snapshot = f.controls.getProjectControls({projectId: 'project'});
	t.true(snapshot.modelGate.enabled);
	t.is(snapshot.configOptions[0]?.currentValue, 'a');
	if (snapshot.configOptions[0])
		snapshot.configOptions[0].currentValue = 'forged';
	t.is(
		f.controls.getProjectControls({projectId: 'project'}).configOptions[0]
			?.currentValue,
		'a',
	);
	t.deepEqual(f.calls, []);
});

test('provider switch returns and publishes Nanocoder-confirmed different model with exactly one RPC (CHAT-10 ACP-14)', async t => {
	const f = fixture();
	await f.observe();
	const request = f.request();
	f.published.length = 0;
	const result = await f.controls.setProjectConfigOption(request);
	t.deepEqual(f.calls, [['session', 'provider', 'b']]);
	t.is(result.configOptions[0]?.currentValue, 'b');
	t.is(result.configOptions[1]?.currentValue, 'confirmed');
	t.not(result.revision, request.revision);
	t.deepEqual(f.published, [result]);
});

test('config changes enter through ThreadService tracked operation admission (CHAT-17)', async t => {
	const f = fixture();
	await f.observe();
	await f.controls.setProjectConfigOption(f.request());
	t.deepEqual(f.admissions, ['config']);
});

test('BUSY during any project turn means zero config RPCs and does not rotate an offers revision (CHAT-17)', async t => {
	const f = fixture();
	await f.observe();
	const request = f.request();
	const pending = deferred<void>();
	const turn = f.operations.runProjectOperation(
		'project',
		'prompt',
		async () => pending.promise,
	);
	const busy = f.controls.getProjectControls({projectId: 'project'});
	t.false(busy.modelGate.enabled);
	t.is(busy.revision, request.revision);
	await t.throwsAsync(f.controls.setProjectConfigOption(request), {
		instanceOf: IpcFailure,
		code: 'BUSY',
	});
	t.deepEqual(f.calls, []);
	pending.resolve();
	await turn;
	t.true(
		f.controls.getProjectControls({projectId: 'project'}).modelGate.enabled,
	);
});

test('stale revisions and foreign values refuse before any config RPC (ACP-14)', async t => {
	const f = fixture();
	await f.observe();
	await t.throwsAsync(
		f.controls.setProjectConfigOption({...f.request(), revision: 'stale'}),
		{code: 'DENIED'},
	);
	await t.throwsAsync(
		f.controls.setProjectConfigOption({...f.request(), value: 'foreign'}),
		{code: 'DENIED'},
	);
	t.deepEqual(f.calls, []);
});

test('offer invalidation during the native root check refuses before any config RPC (ACP-14)', async t => {
	const f = fixture();
	await f.observe();
	const pending = deferred<string>();
	f.canonicalise(() => pending.promise);
	const changing = f.controls.setProjectConfigOption(f.request());
	f.controls.invalidate('project');
	pending.resolve('/fixture');
	await t.throwsAsync(changing, {code: 'DENIED'});
	t.deepEqual(f.calls, []);
});

for (const change of [
	'root',
	'trust',
	'session',
	'thread removal',
	'connection',
] as const) {
	test(`changed ${change} during root validation cannot authorise a config RPC (ACP-14)`, async t => {
		const f = fixture();
		await f.observe();
		const pending = deferred<string>();
		f.canonicalise(() => pending.promise);
		const changing = f.controls.setProjectConfigOption(f.request());
		if (change === 'root')
			f.projects.set('project', {
				...f.project,
				canonicalRoot: '/other',
				sessionCwd: '/other',
			});
		if (change === 'trust')
			f.projects.set('project', {...f.project, trusted: false});
		if (change === 'session')
			f.threads.set('thread', {...f.thread, nanocoderSessionId: 'replacement'});
		if (change === 'thread removal') f.threads.delete('thread');
		if (change === 'connection') f.connections.set('project', {});
		pending.resolve('/fixture');
		await t.throwsAsync(changing);
		t.deepEqual(f.calls, []);
	});
}

test('partial upstream config failure publishes unavailable offers and blocks prompts until a replacement connection (ACP-14)', async t => {
	const f = fixture();
	await f.observe();
	f.mutate(async () => {
		throw new Error('private fixture details');
	});
	await t.throwsAsync(f.controls.setProjectConfigOption(f.request()), {
		code: 'AGENT_UNAVAILABLE',
		message: /restart Nanocoder/,
	});
	const after = f.controls.getProjectControls({projectId: 'project'});
	t.false(after.modelGate.enabled);
	t.deepEqual(after.configOptions, []);
	t.true(after.modelGate.reason?.includes('restart Nanocoder'));
	t.deepEqual(f.published.at(-1), after);
	await f.observe();
	t.false(
		f.controls.getProjectControls({projectId: 'project'}).modelGate.enabled,
	);
	await t.throwsAsync(
		f.operations.runProjectOperation('project', 'prompt', async lease => {
			f.controls.assertPromptAllowed({
				lease,
				connection: f.connection,
			});
		}),
		{code: 'AGENT_UNAVAILABLE'},
	);
	t.is(f.calls.length, 1);
});

test('late config success after invalidation stays reserved through settlement and never publishes a false success (CHAT-17 ACP-14)', async t => {
	const f = fixture();
	await f.observe();
	const pending = deferred<SessionOffers>();
	const invoked = deferred<void>();
	f.mutate(() => {
		invoked.resolve();
		return pending.promise;
	});
	const changing = f.controls.setProjectConfigOption(f.request());
	void changing.catch(() => undefined);
	await invoked.promise;
	f.operations.invalidate('project');
	f.controls.invalidate('project');
	f.connections.set('project', {});
	t.true(f.operations.isBusy('project'));
	const count = f.published.length;
	await t.throwsAsync(f.controls.setProjectConfigOption(f.request()), {
		code: 'BUSY',
	});
	pending.resolve({offeredModes: ['normal'], configOptions: []});
	await t.throwsAsync(changing, {code: 'AGENT_UNAVAILABLE'});
	t.false(f.operations.isBusy('project'));
	t.is(f.published.length, count);
	t.deepEqual(
		f.controls.getProjectControls({projectId: 'project'}).configOptions,
		[],
	);
	t.is(f.calls.length, 1);
});
