import test from 'ava';
import {
	handleRequest,
	IpcFailure,
	type Sender,
} from '@/main/ipc/handle-request';
import {registerWorkspaceHandlers} from '@/main/ipc/workspace';
import type {WorkspaceServices} from '@/main/ipc/workspace-services';
import {APP_ORIGIN} from '@/main/security';
import {
	CHANNELS,
	type IpcResult,
	type ProjectControls,
	type ProjectInfo,
	type SupervisorState,
	type WorkspaceMethod,
	type WorkspaceRequests,
} from '@/shared/ipc';

const projectId = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const project = {projectId};
const thread = {...project, threadId};
const sender: Sender = {url: `${APP_ORIGIN}/index.html`, isMainFrame: true};
const payloads = {
	getSettings: {},
	updateSettings: {patch: {theme: 'light'}},
	getUiState: {},
	updateUiState: {patch: {activeProjectId: projectId}},
	listProjects: {},
	addProject: {},
	openProject: project,
	locateProject: project,
	removeProject: project,
	setProjectDefaultMode: {...project, mode: 'normal'},
	getProjectControls: project,
	setProjectConfigOption: {
		...project,
		revision: threadId,
		configId: 'model',
		value: 'fixture-model',
	},
	getSupervisorState: project,
	startProject: project,
	stopProject: project,
	restartProject: project,
	getCapabilityGates: project,
	getDiagnostics: project,
	exportDiagnostics: {...project, snapshotId: threadId},
	listThreads: {...project, archiveState: 'active'},
	createThread: project,
	openThread: thread,
	getThreadSnapshot: thread,
	renameThread: {...thread, title: 'A thread'},
	archiveThread: {...thread, archived: true},
	removeThread: thread,
	deleteThreadHistory: thread,
	promptThread: {...thread, text: 'Hello'},
	cancelThread: thread,
	setThreadMode: {...thread, mode: 'normal'},
	answerThreadPermission: {
		...thread,
		requestId: 'request-1',
		optionId: 'allow',
	},
	discoverSessions: project,
	importSession: {...project, sessionId: 'session-1'},
} satisfies WorkspaceRequests;
const methods = Object.keys(payloads) as WorkspaceMethod[];

for (const kind of ['high', 'low'] as const) {
	test(`CHAT-08 importing a ${kind} surrogate identity refuses before calling a service`, async t => {
		let calls = 0;
		const request = registered({
			threads: {
				importSession: async () => {
					calls++;
					return null;
				},
			},
		} as unknown as WorkspaceServices);
		const result = await request('importSession', {
			...project,
			sessionId: kind === 'high' ? 'session\uD800' : 'session\uDFFF',
		});
		t.false(result.ok);
		if (!result.ok) {
			t.is(result.error.code, 'VALIDATION');
			t.is(result.error.message, 'Invalid request');
		}
		t.is(calls, 0);
	});
}

test('CHAT-08 an import request preserves its valid Unicode opaque identity exactly', async t => {
	const sessionId = 'session/é/\u{1F680}';
	let imported: string | undefined;
	const request = registered({
		threads: {
			importSession: async (input: {sessionId: string}) => {
				imported = input.sessionId;
				return null;
			},
		},
	} as unknown as WorkspaceServices);
	const result = await request('importSession', {...project, sessionId});
	t.true(result.ok);
	t.is(imported, sessionId);
});

function registered(services?: WorkspaceServices) {
	const handlers = new Map<
		string,
		(payload: unknown, source?: Sender) => Promise<IpcResult<unknown>>
	>();
	registerWorkspaceHandlers(
		(channel, schema, handler, allowedOrigins) => {
			if (handlers.has(channel)) throw new Error('Duplicate channel');
			handlers.set(channel, (payload, source = sender) =>
				handleRequest({
					sender: source,
					payload,
					schema,
					handler,
					allowedOrigins,
				}),
			);
		},
		[APP_ORIGIN],
		services,
	);
	return (method: WorkspaceMethod, payload: unknown, source = sender) => {
		const handler = handlers.get(CHANNELS[method]);
		if (!handler) throw new Error(`Missing handler for ${method}`);
		return handler(payload, source);
	};
}

test('CHAT-08 no workspace IPC request accepts a replay epoch or phase as authority', async t => {
	const request = registered();
	for (const [method, payload] of Object.entries(payloads)) {
		for (const extra of [
			{epoch: threadId},
			{replayEpoch: threadId},
			{replay: {epoch: threadId, phase: 'complete'}},
		]) {
			const result = await request(method as WorkspaceMethod, {
				...payload,
				...extra,
			});
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'VALIDATION');
		}
	}
});

test('cancelThread refuses renderer session identities and malformed scopes before invoking the thread service (ACP-10)', async t => {
	let calls = 0;
	const request = registered({
		threads: {
			cancelThread: async () => {
				calls++;
				return null;
			},
		},
	} as unknown as WorkspaceServices);
	for (const payload of [
		{projectId},
		{sessionId: 'renderer-selected-session'},
		{...thread, sessionId: 'renderer-selected-session'},
		{...thread, extra: true},
		null,
		[],
	]) {
		const result = await request('cancelThread', payload);
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	t.is(calls, 0);
	t.deepEqual(await request('cancelThread', thread), {ok: true, value: null});
	t.is(calls, 1);
});

test('stopProject delegates to the composed lifecycle after strict validation (CHAT-17)', async t => {
	const calls: string[] = [];
	const stopped = {projectId, status: 'stopped'} as SupervisorState;
	const request = registered({
		stopProject: async id => {
			calls.push(id);
			return stopped;
		},
	} as WorkspaceServices);
	const malformed = await request('stopProject', {...project, confirmed: true});
	t.false(malformed.ok);
	if (!malformed.ok) t.is(malformed.error.code, 'VALIDATION');
	t.deepEqual(calls, []);
	t.deepEqual(await request('stopProject', project), {
		ok: true,
		value: stopped,
	});
	t.deepEqual(calls, [projectId]);
});

test('project control schemas refuse arbitrary config authority before reaching a service (CHAT-10 ACP-14)', async t => {
	let calls = 0;
	const request = registered({
		controls: {
			setProjectConfigOption: () => {
				calls++;
				throw new Error('must not reach a mutation');
			},
		},
	} as unknown as WorkspaceServices);
	for (const changes of [
		{revision: 'not-a-revision'},
		{configId: 'credential'},
		{configId: 'mode'},
		{value: true},
		{value: ''},
		{value: 'x'.repeat(513)},
		{value: 'model\nsuffix'},
		{sessionId: 'renderer-session'},
		{threadId},
		{confirmed: true},
		{cwd: '/renderer-root'},
	]) {
		const result = await request('setProjectConfigOption', {
			...payloads.setProjectConfigOption,
			...changes,
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	t.is(calls, 0);
});

test('typed project control handlers return the service snapshot unchanged (CHAT-10 ACP-14)', async t => {
	const confirmed: ProjectControls = {
		projectId,
		revision: threadId,
		modelGate: {enabled: true, reason: null},
		configOptions: [
			{
				id: 'model',
				name: 'model',
				currentValue: 'confirmed-different-model',
				options: [{name: 'confirmed', value: 'confirmed-different-model'}],
			},
		],
	};
	const seen: unknown[] = [];
	const request = registered({
		controls: {
			getProjectControls: scope => {
				seen.push(scope);
				return confirmed;
			},
			setProjectConfigOption: payload => {
				seen.push(payload);
				return confirmed;
			},
		},
	});
	t.deepEqual(await request('getProjectControls', project), {
		ok: true,
		value: confirmed,
	});
	t.deepEqual(
		await request('setProjectConfigOption', payloads.setProjectConfigOption),
		{ok: true, value: confirmed},
	);
	t.deepEqual(seen, [project, payloads.setProjectConfigOption]);
});

for (const method of methods) {
	test(`${method}: returns UNAVAILABLE until the service lands`, async t => {
		t.deepEqual(await registered()(method, payloads[method]), {
			ok: false,
			error: {
				code: 'UNAVAILABLE',
				message: 'This feature is not available yet',
				retryable: false,
			},
		});
	});

	test(`${method}: refuses malformed and unknown-field requests`, async t => {
		const request = registered();
		for (const payload of [
			null,
			undefined,
			[],
			'payload',
			{...payloads[method], extra: true},
			{...payloads[method], projectId: 'x'.repeat(1000)},
		]) {
			const result = await request(method, payload);
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'VALIDATION');
		}
	});

	test(`${method}: refuses non-app senders before reaching a service`, async t => {
		const request = registered();
		for (const source of [
			{url: 'https://example.com/', isMainFrame: true},
			{url: 'app://other/index.html', isMainFrame: true},
			{...sender, isMainFrame: false},
			{url: undefined, isMainFrame: true},
		]) {
			const result = await request(method, payloads[method], source);
			t.false(result.ok);
			if (!result.ok) t.is(result.error.code, 'DENIED');
		}
	});
}

test('settings refuse secrets, runtime paths and yolo defaults', async t => {
	const request = registered();
	for (const patch of [
		{apiKey: 'not-a-real-key'},
		{token: 'not-a-real-token'},
		{nanocoderOverridePath: '/untrusted/cli.js'},
		{defaultMode: 'yolo'},
		{theme: 'x'.repeat(1000)},
	]) {
		const result = await request('updateSettings', {patch});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
	const result = await request('setProjectDefaultMode', {
		...project,
		mode: 'yolo',
	});
	t.false(result.ok);
	if (!result.ok) t.is(result.error.code, 'VALIDATION');
});

test('UI state refuses content fields and unbounded lists or window sizes', async t => {
	for (const patch of [
		{messages: ['not persisted']},
		{fileContents: 'not persisted'},
		{toolOutput: 'not persisted'},
		{openThreadIds: Array.from({length: 101}, () => threadId)},
		{
			window: {
				width: 500,
				height: 500,
				x: 0,
				y: 0,
				maximised: false,
				extra: true,
			},
		},
		{window: {width: 20_000, height: 500, x: 0, y: 0, maximised: false}},
	]) {
		const result = await registered()('updateUiState', {patch});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
});

test('thread inputs are bounded and cannot grant trust or confirm deletion', async t => {
	const request = registered();
	for (const [method, payload] of [
		['promptThread', {...thread, text: 'x'.repeat(100_001)}],
		['promptThread', {...thread, text: '   '}],
		['renameThread', {...thread, title: 'x'.repeat(501)}],
		['importSession', {...project, sessionId: 'x'.repeat(201)}],
		[
			'answerThreadPermission',
			{...thread, requestId: 'a', optionId: 'x'.repeat(201)},
		],
		['addProject', {canonicalRoot: '/arbitrary', trusted: true}],
		['deleteThreadHistory', {...thread, confirmed: true}],
		[
			'exportDiagnostics',
			{...project, snapshotId: threadId, lines: ['unreviewed']},
		],
	] as const) {
		const result = await request(method, payload);
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
	}
});

const chosen: ProjectInfo = {
	id: projectId,
	canonicalRoot: '/chosen',
	sessionCwd: '/chosen',
	displayName: 'chosen',
	trusted: true,
	defaultMode: 'normal',
	createdAt: '2026-10-29T00:00:00.000Z',
	lastOpenedAt: '2026-10-29T00:00:00.000Z',
	availability: 'available',
};

test('dispatches every valid intent to the injected service', async t => {
	const calls: {scope: string; method: string; args: unknown[]}[] = [];
	const service = (scope: string) =>
		new Proxy(
			{},
			{
				get:
					(_target, method: string) =>
					(...args: unknown[]) => {
						calls.push({scope, method, args});
						return null;
					},
			},
		);
	const services = {
		store: {
			...Object.fromEntries(
				['getSettings', 'updateSettings', 'getUiState', 'updateUiState'].map(
					method => [
						method,
						(...args: unknown[]) => calls.push({scope: 'store', method, args}),
					],
				),
			),
			projects: {
				list: () => [],
				get: () => chosen,
			},
		},
		projects: service('projects'),
		supervisor: service('supervisor'),
		threads: service('threads'),
		diagnostics: service('diagnostics'),
		controls: service('controls'),
	} as unknown as WorkspaceServices;
	const request = registered(services);
	for (const method of methods) {
		const result = await request(method, payloads[method]);
		t.true(result.ok, method);
	}
	t.is(calls.length, methods.length - 1);
	t.deepEqual(calls.find(call => call.method === 'updateSettings')?.args, [
		{theme: 'light'},
	]);
	t.deepEqual(calls.find(call => call.method === 'updateUiState')?.args, [
		{activeProjectId: projectId},
	]);
	t.deepEqual(calls.find(call => call.method === 'ensureProcess')?.args, [
		chosen,
	]);
	t.deepEqual(calls.find(call => call.method === 'restart')?.args, [chosen]);
	t.deepEqual(calls.find(call => call.method === 'promptThread')?.args, [
		payloads.promptThread,
	]);
});

test('start and restart refuse missing or untrusted projects without launching anything', async t => {
	let starts = 0;
	for (const selected of [undefined, {...chosen, trusted: false}]) {
		const request = registered({
			store: {projects: {get: () => selected}},
			supervisor: {
				ensureProcess: () => {
					starts++;
				},
				restart: () => {
					starts++;
				},
			},
		} as unknown as WorkspaceServices);
		for (const method of ['startProject', 'restartProject'] as const) {
			const result = await request(method, project);
			t.false(result.ok);
			if (!result.ok)
				t.is(result.error.code, selected ? 'DENIED' : 'NOT_FOUND');
		}
	}
	t.is(starts, 0);
});

test('main-owned recovery refuses unknown or stale handles and renderer paths', async t => {
	const handles = new Set([projectId]);
	let launches = 0;
	const state: SupervisorState = {
		projectId,
		status: 'ready',
		reason: null,
		runtime: null,
		agent: null,
		gates: null,
		activeThreadId: null,
		exit: null,
		restart: {attempt: 0, limit: 3, nextAttemptAt: null},
	};
	const request = registered({
		restartProject: async handle => {
			if (!handles.has(handle))
				throw new IpcFailure('NOT_FOUND', 'Project not found');
			launches++;
			return state;
		},
	});
	const unknown = await request('restartProject', {projectId: threadId});
	t.false(unknown.ok);
	if (!unknown.ok) t.is(unknown.error.code, 'NOT_FOUND');
	t.deepEqual(await request('restartProject', project), {
		ok: true,
		value: state,
	});
	for (const extra of [
		{canonicalRoot: '/renderer-path'},
		{path: '/renderer-path'},
		{trusted: true},
	]) {
		const denied = await request('restartProject', {...project, ...extra});
		t.false(denied.ok);
		if (!denied.ok) t.is(denied.error.code, 'VALIDATION');
	}
	handles.clear();
	const stale = await request('restartProject', project);
	t.false(stale.ok);
	if (!stale.ok) t.is(stale.error.code, 'NOT_FOUND');
	t.is(launches, 1);
});
