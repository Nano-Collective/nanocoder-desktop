import test from 'ava';
import {createSessionImports} from '@/renderer/session-import-controller';
import type {DesktopApi} from '@/shared/desktop-api';
import type {DiscoveredSession, IpcResult, ThreadInfo} from '@/shared/ipc';

const candidate = (id = 'saved-a'): DiscoveredSession => ({
	id,
	title: `<script>${id}</script>`,
	sessionCwd: '/fixture/project',
	lastActivityAt: '2026-10-29T12:00:00.000Z',
});
const imported = (projectId: string, sessionId: string): ThreadInfo => ({
	id: 'desktop-thread',
	projectId,
	nanocoderSessionId: sessionId,
	title: 'imported title',
	archiveState: 'active',
	runState: 'ready',
	lastActivityAt: '2026-10-29T12:00:00.000Z',
	sessionCwd: '/fixture/project',
	mode: 'normal',
	viewOnlyReason: null,
});
const ok = <T>(value: T): IpcResult<T> => ({ok: true, value});
const failure = <T>(): IpcResult<T> => ({
	ok: false,
	error: {
		code: 'UNAVAILABLE',
		message: '<script>safe refusal</script>',
		retryable: false,
	},
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}
function fixture() {
	const calls: unknown[] = [];
	const states: unknown[] = [];
	const bridge: Pick<DesktopApi, 'discoverSessions' | 'importSession'> = {
		discoverSessions: async request => {
			calls.push(['discover', request]);
			return ok([candidate()]);
		},
		importSession: async request => {
			calls.push(['import', request]);
			return ok(imported(request.projectId, request.sessionId));
		},
	};
	const model = createSessionImports({
		bridge,
		onChange: state => states.push(state),
	});
	return {bridge, calls, states, model};
}

test('ACP-18 renderer discovers only an explicitly ready selected project, never on offline or repeated selection', async t => {
	const f = fixture();
	await f.model.selectProject('project-a', false);
	t.deepEqual(f.calls, []);
	await f.model.selectProject('project-a', true);
	t.deepEqual(f.calls, [['discover', {projectId: 'project-a'}]]);
	t.deepEqual(f.model.getState().sessions, [candidate()]);
	await f.model.selectProject('project-a', true);
	t.is(f.calls.length, 1);
	await f.model.refresh();
	t.is(f.calls.length, 2);
	await f.model.selectProject(null, false);
	t.deepEqual(f.model.getState().sessions, []);
});

test('ACP-18 renderer imports only an offered unknown ID through metadata IPC without another discovery or auto-open', async t => {
	const f = fixture();
	await f.model.selectProject('project-a', true);
	t.false(await f.model.importSession('arbitrary'));
	t.true(await f.model.importSession('saved-a'));
	t.deepEqual(f.calls, [
		['discover', {projectId: 'project-a'}],
		['import', {projectId: 'project-a', sessionId: 'saved-a'}],
	]);
	t.deepEqual(f.model.getState().sessions, []);
	t.is(f.model.getState().importing, null);
	t.false(await f.model.importSession('saved-a'));
});

test('ACP-18 known-session publication filters candidates without another bridge call or changing another project', async t => {
	const f = fixture();
	await f.model.selectProject('project-a', true);
	f.model.setKnownSessions('project-b', ['saved-a']);
	t.deepEqual(f.model.getState().sessions, [candidate()]);
	f.model.setKnownSessions('project-a', ['saved-a']);
	t.deepEqual(f.model.getState().sessions, []);
	t.is(f.calls.length, 1);
	await f.model.refresh();
	t.deepEqual(f.model.getState().sessions, []);
});

test('ACP-18 renderer suppresses duplicate import clicks and refresh while metadata import is pending', async t => {
	const f = fixture();
	await f.model.selectProject('project-a', true);
	const pending = deferred<IpcResult<ThreadInfo>>();
	let count = 0;
	f.bridge.importSession = async () => {
		count++;
		return pending.promise;
	};
	const first = f.model.importSession('saved-a');
	t.is(f.model.getState().importing, 'saved-a');
	t.false(await f.model.importSession('saved-a'));
	t.false(await f.model.refresh());
	t.is(count, 1);
	pending.resolve(ok(imported('project-a', 'saved-a')));
	t.true(await first);
});

test('ACP-18 renderer rejects reordered list responses and never exposes another project after switching', async t => {
	const f = fixture();
	const old = deferred<IpcResult<DiscoveredSession[]>>();
	f.bridge.discoverSessions = async () => old.promise;
	const first = f.model.selectProject('project-a', true);
	f.bridge.discoverSessions = async () => ok([candidate('saved-b')]);
	await f.model.selectProject('project-b', true);
	old.resolve(ok([candidate('private-old-a')]));
	await first;
	t.is(f.model.getState().projectId, 'project-b');
	t.deepEqual(f.model.getState().sessions, [candidate('saved-b')]);
	const reordered = deferred<IpcResult<DiscoveredSession[]>>();
	f.bridge.discoverSessions = async () => reordered.promise;
	const earlier = f.model.refresh();
	f.bridge.discoverSessions = async () => ok([candidate('latest')]);
	await f.model.refresh();
	reordered.resolve(failure());
	await earlier;
	t.deepEqual(f.model.getState().sessions, [candidate('latest')]);
	t.is(f.model.getState().error, null);
});

for (const end of ['offline', 'switch', 'dispose'] as const) {
	test(`ACP-18 renderer ${end} ignores a late import success without queueing a prompt or reviving state`, async t => {
		const f = fixture();
		await f.model.selectProject('project-a', true);
		const pending = deferred<IpcResult<ThreadInfo>>();
		f.bridge.importSession = async () => pending.promise;
		const first = f.model.importSession('saved-a');
		t.is(f.model.getState().importing, 'saved-a');
		if (end === 'offline') await f.model.selectProject('project-a', false);
		if (end === 'switch') await f.model.selectProject('project-b', true);
		if (end === 'dispose') f.model.dispose();
		const before = f.model.getState();
		const changes = f.states.length;
		pending.resolve(ok(imported('project-a', 'saved-a')));
		t.false(await first);
		t.deepEqual(f.model.getState(), before);
		t.is(f.states.length, changes);
	});
}

test('ACP-18 renderer reports exact import refusals and rejects a mismatched returned owner or session', async t => {
	const f = fixture();
	await f.model.selectProject('project-a', true);
	f.bridge.importSession = async () => failure();
	t.false(await f.model.importSession('saved-a'));
	t.is(f.model.getState().error, '<script>safe refusal</script>');
	t.deepEqual(f.model.getState().sessions, [candidate()]);
	f.bridge.importSession = async () => ok(imported('project-b', 'saved-a'));
	t.false(await f.model.importSession('saved-a'));
	t.truthy(f.model.getState().error);
	f.bridge.importSession = async () =>
		ok(imported('project-a', 'different-id'));
	t.false(await f.model.importSession('saved-a'));
	t.deepEqual(f.model.getState().sessions, [candidate()]);
});

test('ACP-18 renderer contains rejected bridge calls and clears loading without leaking thrown details', async t => {
	const f = fixture();
	f.bridge.discoverSessions = async () => {
		throw new Error('private failure');
	};
	await f.model.selectProject('project-a', true);
	t.is(f.model.getState().error, 'saved sessions are unavailable');
	t.false(f.model.getState().loading);
	f.bridge.discoverSessions = async () => ok([candidate()]);
	await f.model.refresh();
	f.bridge.importSession = async () => {
		throw new Error('private failure');
	};
	t.false(await f.model.importSession('saved-a'));
	t.is(f.model.getState().error, 'the saved session could not be imported');
	t.is(f.model.getState().importing, null);
	t.deepEqual(f.model.getState().sessions, [candidate()]);
});
