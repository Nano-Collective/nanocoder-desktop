import test from 'ava';
import type {ControlSessionContext} from '@/main/controls/project-controls';
import {createThreadModes} from '@/main/controls/thread-modes';
import type {NanocoderConnection} from '@/main/nanocoder/acp-client';
import {createProjectOperations} from '@/main/threads/project-operations';
import type {
	DefaultMode,
	NanocoderMode,
	ProjectInfo,
	ThreadInfo,
} from '@/shared/ipc';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function fixture(saved = false) {
	const project: ProjectInfo = {
		id: 'project',
		canonicalRoot: '/fixture',
		sessionCwd: '/fixture',
		trusted: true,
		displayName: 'fixture',
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
	const initial: ThreadInfo = {
		id: 'thread',
		projectId: 'project',
		sessionCwd: '/fixture',
		nanocoderSessionId: saved ? 'session' : null,
		title: 'fixture',
		archiveState: 'active',
		runState: saved ? 'ready' : 'new',
		lastActivityAt: '',
		mode: 'normal',
		viewOnlyReason: null,
	};
	const projects = new Map([[project.id, project]]);
	const threads = new Map([[initial.id, initial]]);
	const connections = new Map<string, NanocoderConnection>();
	const writes: ThreadInfo[] = [];
	const projectWrites: ProjectInfo[] = [];
	const published: ThreadInfo[] = [];
	const projectPublished: ProjectInfo[] = [];
	const order: string[] = [];
	let confirmations = 0;
	let confirm = async () => true;
	let canonicalise = async (path: string) => path;
	let offeredModes: NanocoderMode[] = [
		'normal',
		'plan',
		'yolo',
		'auto-accept',
		'architect',
	];
	let ready = true;
	let change = async (_id: string, mode: NanocoderMode) => ({
		id: 'session',
		mode,
	});
	const connection = {
		agent: {root: '/fixture'},
		getSessionOffers: () =>
			ready ? {offeredModes, configOptions: []} : undefined,
		setMode: (id: string, mode: NanocoderMode) => {
			order.push(mode);
			return change(id, mode);
		},
	} as unknown as NanocoderConnection;
	if (saved) connections.set(project.id, connection);
	const operations = createProjectOperations({
		getProject: id => projects.get(id),
		getThread: (projectId, id) => {
			const row = threads.get(id);
			return row?.projectId === projectId ? row : undefined;
		},
		getConnection: id => connections.get(id),
	});
	const admissions: string[] = [];
	const modes = createThreadModes({
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
		saveThread: row => {
			writes.push(row);
			threads.set(row.id, row);
		},
		saveProject: row => {
			projectWrites.push(row);
			projects.set(row.id, row);
		},
		publishThread: row => published.push(row),
		publishProject: row => projectPublished.push(row),
		canonicalise: path => canonicalise(path),
		confirmYolo: async () => {
			confirmations++;
			return confirm();
		},
	});
	const request = (mode: NanocoderMode) => ({
		projectId: 'project',
		threadId: 'thread',
		mode,
	});
	const prepare = async (
		firstSend = false,
		source: 'new' | 'resume' = saved ? 'resume' : 'new',
	) => {
		await operations.runProjectOperation(
			'project',
			firstSend ? 'prompt' : 'open',
			async lease => {
				const before = threads.get('thread') ?? initial;
				modes.validateBeforePrepare(lease, before);
				connections.set('project', connection);
				if (!before.nanocoderSessionId) order.push('new');
				const row = {
					...before,
					nanocoderSessionId: 'session',
					mode: before.mode === 'yolo' ? ('normal' as const) : before.mode,
				};
				threads.set('thread', row);
				operations.bindSession(lease, 'session');
				order.push('safe-mode');
				const context: ControlSessionContext = {
					lease,
					thread: row,
					connection,
					session: {id: 'session', mode: row.mode},
					source,
				};
				modes.onSessionPrepared(context);
				if (firstSend) {
					await modes.beforeFirstPrompt(context);
					order.push('prompt');
				}
			},
		);
	};
	return {
		project,
		initial,
		projects,
		threads,
		connections,
		connection,
		operations,
		modes,
		admissions,
		writes,
		projectWrites,
		published,
		projectPublished,
		order,
		request,
		prepare,
		confirmations: () => confirmations,
		confirm: (next: typeof confirm) => {
			confirm = next;
		},
		canonicalise: (next: typeof canonicalise) => {
			canonicalise = next;
		},
		offers: (next: NanocoderMode[]) => {
			offeredModes = next;
		},
		change: (next: typeof change) => {
			change = next;
		},
		unready: () => {
			ready = false;
		},
	};
}

test('new-thread mode choices do not create a session or implicitly change the project default (CHAT-04 CHAT-11)', async t => {
	const f = fixture();
	const selected = await f.modes.setThreadMode(f.request('plan'));
	t.is(selected.mode, 'plan');
	t.is(selected.nanocoderSessionId, null);
	t.deepEqual(f.order, []);
	t.is(f.projects.get('project')?.defaultMode, 'normal');
	t.deepEqual(f.projectWrites, []);
	t.is(f.modes.resolveLiveMode('project', 'thread', null, undefined), 'plan');
});

test('mode and default changes enter through ThreadService tracked operation admission (CHAT-17)', async t => {
	const f = fixture();
	await f.modes.setThreadMode(f.request('plan'));
	await f.modes.setProjectDefaultMode({
		projectId: 'project',
		mode: 'architect',
	});
	t.deepEqual(f.admissions, ['mode', 'default-mode']);
});

test('new-thread yolo confirms when picked, never writes yolo and applies after safe creation but before prompt (CHAT-04 DEC-31)', async t => {
	const f = fixture();
	t.is((await f.modes.setThreadMode(f.request('yolo'))).mode, 'yolo');
	t.is(f.confirmations(), 1);
	t.deepEqual(f.order, []);
	t.true(f.writes.every(row => row.mode !== 'yolo'));
	t.is(f.threads.get('thread')?.mode, 'normal');
	await f.prepare(true);
	t.deepEqual(f.order, ['new', 'safe-mode', 'yolo', 'prompt']);
	t.is(f.confirmations(), 1);
	t.is(
		f.modes.resolveLiveMode('project', 'thread', 'session', f.connection),
		'yolo',
	);
	t.is(f.threads.get('thread')?.mode, 'normal');
});

test('cancel-default yolo confirmation returns the unchanged mode without an RPC, write or publication (DEC-31)', async t => {
	const f = fixture();
	f.confirm(async () => false);
	t.is((await f.modes.setThreadMode(f.request('yolo'))).mode, 'normal');
	t.deepEqual(f.order, []);
	t.deepEqual(f.writes, []);
	t.deepEqual(f.published, []);
	t.is(
		f.modes.resolveLiveMode('project', 'thread', null, undefined),
		undefined,
	);
});

test('live yolo survives safe durable-row reads but every new entry confirms again (DEC-31)', async t => {
	const f = fixture(true);
	await f.prepare();
	f.order.length = 0;
	await f.modes.setThreadMode(f.request('yolo'));
	t.is(f.threads.get('thread')?.mode, 'normal');
	t.is(
		f.modes.resolveLiveMode('project', 'thread', 'session', f.connection),
		'yolo',
	);
	await f.modes.setThreadMode(f.request('plan'));
	await f.modes.setThreadMode(f.request('yolo'));
	t.is(f.confirmations(), 2);
	t.deepEqual(f.order, ['yolo', 'plan', 'yolo']);
	t.true(f.writes.every(row => row.mode !== 'yolo'));
	t.is(f.threads.get('thread')?.mode, 'plan');
	t.is(f.published.at(-1)?.mode, 'yolo');
});

test('restart clears live yolo and cannot restore it from the safe durable fallback (DEC-31)', async t => {
	const f = fixture(true);
	await f.prepare();
	await f.modes.setThreadMode(f.request('yolo'));
	f.modes.invalidate('project');
	t.is(
		f.modes.resolveLiveMode('project', 'thread', 'session', f.connection),
		undefined,
	);
	await f.prepare(false, 'resume');
	t.is(
		f.modes.resolveLiveMode('project', 'thread', 'session', f.connection),
		'normal',
	);
	t.is(f.confirmations(), 1);
	t.is(f.order.filter(mode => mode === 'yolo').length, 1);
});

test('stale lifecycle epoch refuses a pending yolo before session creation and requires a fresh selection (DEC-31)', async t => {
	const f = fixture();
	await f.modes.setThreadMode(f.request('yolo'));
	f.operations.invalidate('project');
	await t.throwsAsync(f.prepare(true), {code: 'DENIED'});
	t.deepEqual(f.order, []);
	await f.modes.setThreadMode(f.request('normal'));
	await f.prepare(true);
	t.false(f.order.includes('yolo'));
});

test('failed or abandoned preparation cannot carry a pending choice into a later operation (DEC-31)', async t => {
	const f = fixture();
	await f.modes.setThreadMode(f.request('yolo'));
	await t.throwsAsync(
		f.operations.runProjectOperation('project', 'prompt', async lease => {
			f.modes.validateBeforePrepare(lease, f.initial);
			throw new Error('fixture preparation failed');
		}),
	);
	await t.throwsAsync(f.prepare(true), {code: 'DENIED'});
	t.deepEqual(f.order, []);
});

test('unknown and unoffered modes refuse before any RPC or native yolo prompt (ACP-13)', async t => {
	const f = fixture(true);
	await f.prepare();
	f.order.length = 0;
	f.offers(['normal']);
	await t.throwsAsync(
		f.modes.setThreadMode(f.request('future' as NanocoderMode)),
		{code: 'DENIED'},
	);
	await t.throwsAsync(f.modes.setThreadMode(f.request('yolo')), {
		code: 'DENIED',
	});
	t.deepEqual(f.order, []);
	t.is(f.confirmations(), 0);
});

test('a pending mode is checked against newly offered modes and never silently falls back (ACP-13)', async t => {
	const f = fixture();
	await f.modes.setThreadMode(f.request('yolo'));
	f.offers(['normal']);
	await t.throwsAsync(f.prepare(true), {code: 'DENIED'});
	t.deepEqual(f.order, ['new', 'safe-mode']);
	t.is(
		f.modes.resolveLiveMode('project', 'thread', 'session', f.connection),
		'normal',
	);
});

test('explicit non-yolo default saves only the project, never an existing thread or session (CHAT-11)', async t => {
	const f = fixture();
	const result = await f.modes.setProjectDefaultMode({
		projectId: 'project',
		mode: 'plan',
	});
	t.is(result.defaultMode, 'plan');
	t.is(f.projects.get('project')?.defaultMode, 'plan');
	t.is(f.threads.get('thread')?.mode, 'normal');
	t.deepEqual(f.writes, []);
	t.deepEqual(f.order, []);
	t.deepEqual(f.projectPublished, [result]);
	await t.throwsAsync(
		f.modes.setProjectDefaultMode({
			projectId: 'project',
			mode: 'yolo' as DefaultMode,
		}),
		{code: 'DENIED'},
	);
	t.is(f.projectWrites.length, 1);
});

test('every project turn holds mode and default mutations BUSY with no prompt, RPC or write (CHAT-17)', async t => {
	const f = fixture();
	let release!: () => void;
	const pending = new Promise<void>(resolve => {
		release = resolve;
	});
	const turn = f.operations.runProjectOperation(
		'project',
		'prompt',
		async () => pending,
	);
	await t.throwsAsync(f.modes.setThreadMode(f.request('yolo')), {code: 'BUSY'});
	await t.throwsAsync(
		f.modes.setProjectDefaultMode({projectId: 'project', mode: 'plan'}),
		{code: 'BUSY'},
	);
	t.is(f.confirmations(), 0);
	t.deepEqual(f.order, []);
	t.deepEqual(f.writes, []);
	t.deepEqual(f.projectWrites, []);
	release();
	await turn;
});

test('a missing live acknowledgement cannot be replaced by a durable fallback at prompt admission (DEC-31)', async t => {
	const f = fixture(true);
	await t.throwsAsync(
		f.operations.runProjectOperation('project', 'prompt', async lease => {
			await f.modes.beforeFirstPrompt({
				lease,
				thread: f.initial,
				connection: f.connection,
				session: {id: 'session', mode: 'normal'},
				source: 'resume',
			});
		}),
		{code: 'AGENT_UNAVAILABLE'},
	);
	t.deepEqual(f.order, []);
});

test('mode offers changed during native confirmation refuse before an RPC (ACP-13)', async t => {
	const f = fixture(true);
	await f.prepare();
	f.order.length = 0;
	const invoked = deferred<void>();
	const confirmation = deferred<boolean>();
	f.confirm(() => {
		invoked.resolve();
		return confirmation.promise;
	});
	const changing = f.modes.setThreadMode(f.request('yolo'));
	void changing.catch(() => undefined);
	await invoked.promise;
	f.offers(['normal']);
	confirmation.resolve(true);
	await t.throwsAsync(changing, {code: 'DENIED'});
	t.deepEqual(f.order, []);
});

test('native canonical root changed during confirmation refuses before an RPC (ACP-13)', async t => {
	const f = fixture(true);
	await f.prepare();
	f.order.length = 0;
	const invoked = deferred<void>();
	const confirmation = deferred<boolean>();
	f.confirm(() => {
		invoked.resolve();
		return confirmation.promise;
	});
	const changing = f.modes.setThreadMode(f.request('yolo'));
	void changing.catch(() => undefined);
	await invoked.promise;
	f.canonicalise(async () => '/replaced-root');
	confirmation.resolve(true);
	await t.throwsAsync(changing, {code: 'DENIED'});
	t.deepEqual(f.order, []);
});

test('a late acknowledged yolo after scope refusal must not leave a cached normal claim (DEC-31)', async t => {
	const f = fixture();
	await f.modes.setThreadMode(f.request('yolo'));
	const invoked = deferred<void>();
	const acknowledgement = deferred<{id: string; mode: NanocoderMode}>();
	f.change(() => {
		invoked.resolve();
		return acknowledgement.promise;
	});
	const sending = f.prepare(true);
	void sending.catch(() => undefined);
	await invoked.promise;
	const row = f.threads.get('thread');
	if (!row) throw new Error('fixture row missing');
	f.threads.set('thread', {...row, archiveState: 'archived'});
	acknowledgement.resolve({id: 'session', mode: 'yolo'});
	await t.throwsAsync(sending, {code: 'DENIED'});
	t.is(
		f.modes.resolveLiveMode('project', 'thread', 'session', f.connection),
		undefined,
	);
	t.true(f.writes.every(saved => saved.mode !== 'yolo'));
	t.false(f.order.includes('prompt'));
});
