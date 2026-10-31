import test from 'ava';
import {
	readRecentProjects,
	subscribeProjectRefresh,
} from '@/renderer/project-refresh';
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult, ProjectEvent, ProjectInfo, UiState} from '@/shared/ipc';

const project: ProjectInfo = {
	id: '11111111-1111-4111-8111-111111111111',
	canonicalRoot: '/fixture',
	sessionCwd: '/fixture',
	displayName: 'fixture',
	trusted: false,
	defaultMode: 'normal',
	availability: 'available',
	createdAt: '',
	lastOpenedAt: '',
};
const ui = (activeProjectId: string | null): UiState => ({
	window: {width: 1240, height: 900, x: null, y: null, maximised: false},
	activeProjectId,
	activeThreadId: null,
	openThreadIds: [],
	inspector: null,
	bottomPanel: null,
});
const changed = (sequence: number, projectId = project.id): ProjectEvent => ({
	type: 'projects-changed',
	projectId,
	sequence,
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return {promise, resolve, reject};
}

function reader() {
	let sequence = 0;
	let mounted = true;
	const state = {
		projects: [] as ProjectInfo[],
		activeProjectId: null as string | null,
		errors: [] as string[],
	};
	return {
		state,
		unmount: () => {
			mounted = false;
		},
		refresh: (desktop: Pick<DesktopApi, 'listProjects' | 'getUiState'>) => {
			const request = ++sequence;
			return readRecentProjects(desktop, {
				current: () => mounted && request === sequence,
				projects: value => {
					state.projects = value;
				},
				activeProject: value => {
					state.activeProjectId = value;
				},
				failed: message => state.errors.push(message),
			});
		},
	};
}

test('project changes refresh across projects but stale, duplicate and turn sequences do not', async t => {
	let receive!: (event: ProjectEvent) => void;
	let stopped = false;
	let refreshes = 0;
	const unsubscribe = subscribeProjectRefresh(
		{
			onProjectEvent: listener => {
				receive = listener;
				return () => {
					stopped = true;
				};
			},
		},
		async () => {
			refreshes++;
		},
	);
	receive(changed(2));
	receive(changed(2));
	receive(changed(1));
	t.is(refreshes, 1);
	receive({
		type: 'turn',
		projectId: project.id,
		threadId: 'thread',
		sequence: 100,
		events: [],
	});
	receive(changed(3));
	receive({
		type: 'thread-removed',
		projectId: project.id,
		threadId: 'thread',
		sequence: 5,
	});
	receive(changed(4));
	t.is(refreshes, 2);
	receive(changed(1, '22222222-2222-4222-8222-222222222222'));
	receive({type: 'project', projectId: project.id, sequence: 6, project});
	receive({type: 'project-removed', projectId: project.id, sequence: 7});
	t.is(refreshes, 5);
	const state = {
		projectId: project.id,
		status: 'ready' as const,
		reason: null,
		runtime: null,
		agent: null,
		gates: null,
		activeThreadId: null,
		exit: null,
		restart: {attempt: 0, limit: 0, nextAttemptAt: null},
	};
	receive({type: 'supervisor', projectId: project.id, sequence: 8, state});
	t.is(refreshes, 5);
	receive({
		type: 'supervisor',
		projectId: project.id,
		sequence: 9,
		state: {...state, status: 'untrusted'},
	});
	t.is(refreshes, 6);
	unsubscribe();
	receive(changed(10));
	t.true(stopped);
	t.is(refreshes, 6);
});

test('a late empty startup response cannot overwrite newer projects or active scope', async t => {
	const oldList = deferred<IpcResult<ProjectInfo[]>>();
	const oldUi = deferred<IpcResult<UiState>>();
	const {state, refresh} = reader();
	const initial = refresh({
		listProjects: () => oldList.promise,
		getUiState: () => oldUi.promise,
	});
	await refresh({
		listProjects: async () => ({ok: true, value: [project]}),
		getUiState: async () => ({ok: true, value: ui(project.id)}),
	});
	oldList.resolve({ok: true, value: []});
	oldUi.resolve({ok: true, value: ui(null)});
	await initial;
	t.deepEqual(state.projects, [project]);
	t.is(state.activeProjectId, project.id);
	t.deepEqual(state.errors, []);
});

test('stale rejected reads and unmounted reads cannot change state or report errors', async t => {
	const rejected = deferred<IpcResult<ProjectInfo[]>>();
	const {state, refresh, unmount} = reader();
	const initial = refresh({
		listProjects: () => rejected.promise,
		getUiState: async () => ({ok: true, value: ui(null)}),
	});
	await refresh({
		listProjects: async () => ({ok: true, value: [project]}),
		getUiState: async () => ({ok: true, value: ui(project.id)}),
	});
	rejected.reject(new Error('old read'));
	await initial;
	const late = deferred<IpcResult<ProjectInfo[]>>();
	const pending = refresh({
		listProjects: () => late.promise,
		getUiState: async () => ({ok: true, value: ui(null)}),
	});
	unmount();
	late.resolve({ok: true, value: []});
	await pending;
	t.deepEqual(state.projects, [project]);
	t.is(state.activeProjectId, project.id);
	t.deepEqual(state.errors, []);
});

test('current read refusals and failures remain visible without replacing projects', async t => {
	const {state, refresh} = reader();
	await refresh({
		listProjects: async () => ({
			ok: false,
			error: {
				code: 'UNAVAILABLE',
				message: 'fixture refusal',
				retryable: false,
			},
		}),
		getUiState: async () => ({ok: true, value: ui(project.id)}),
	});
	await refresh({
		listProjects: async () => {
			throw new Error('not exposed');
		},
		getUiState: async () => ({ok: true, value: ui(null)}),
	});
	t.deepEqual(state.projects, []);
	t.is(state.activeProjectId, project.id);
	t.deepEqual(state.errors, [
		'fixture refusal',
		'recent projects are unavailable',
	]);
});
