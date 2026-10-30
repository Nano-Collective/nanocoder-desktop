import test from 'ava';
import {createProjectControlsController} from '@/renderer/project-controls';
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult, ProjectControls, ProjectEvent} from '@/shared/ipc';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function controls(projectId = 'project', value = 'old'): ProjectControls {
	return {
		projectId,
		revision: `revision-${value}`,
		modelGate: {enabled: true, reason: null},
		configOptions: [
			{
				id: 'model',
				name: 'model',
				currentValue: value,
				options: [
					{name: 'old', value: 'old'},
					{name: 'requested', value: 'requested'},
					{name: 'confirmed', value: 'confirmed'},
				],
			},
		],
	};
}

function fixture() {
	let event!: (value: ProjectEvent) => void;
	let unsubscribed = false;
	let reason: string | null = null;
	const reads: string[] = [];
	const writes: Array<Parameters<DesktopApi['setProjectConfigOption']>[0]> = [];
	let read: DesktopApi['getProjectControls'] = async ({projectId}) => ({
		ok: true,
		value: controls(projectId),
	});
	let write: DesktopApi['setProjectConfigOption'] = async ({projectId}) => ({
		ok: true,
		value: controls(projectId, 'confirmed'),
	});
	const controller = createProjectControlsController({
		bridge: {
			getProjectControls: request => {
				reads.push(request.projectId);
				return read(request);
			},
			setProjectConfigOption: request => {
				writes.push(request);
				return write(request);
			},
			onProjectEvent: callback => {
				event = callback;
				return () => {
					unsubscribed = true;
				};
			},
		},
		onChange() {},
		controlReason: () => reason,
	});
	return {
		controller,
		reads,
		writes,
		event: (value: ProjectEvent) => event(value),
		read: (next: typeof read) => {
			read = next;
		},
		write: (next: typeof write) => {
			write = next;
		},
		reason: (value: string | null) => {
			reason = value;
		},
		unsubscribed: () => unsubscribed,
	};
}

test('project control reads do not create a session and keep offers independent of thread selection (CHAT-04)', async t => {
	const f = fixture();
	await f.controller.selectProject('project');
	t.deepEqual(f.reads, ['project']);
	t.deepEqual(f.controller.getState().controls, controls());
	t.deepEqual(f.writes, []);
	await f.controller.selectProject('project');
	t.deepEqual(f.reads, ['project']);
});

test('config selection sends main-owned revision and shows only the confirmed result (ACP-14)', async t => {
	const f = fixture();
	await f.controller.selectProject('project');
	const pending = deferred<IpcResult<ProjectControls>>();
	f.write(() => pending.promise);
	const changing = f.controller.setConfig('model', 'requested');
	t.true(f.controller.getState().pending);
	t.is(f.controller.getState().controls?.configOptions[0]?.currentValue, 'old');
	t.deepEqual(f.writes, [
		{
			projectId: 'project',
			revision: 'revision-old',
			configId: 'model',
			value: 'requested',
		},
	]);
	pending.resolve({ok: true, value: controls('project', 'confirmed')});
	t.true(await changing);
	t.is(
		f.controller.getState().controls?.configOptions[0]?.currentValue,
		'confirmed',
	);
	t.false(f.controller.getState().pending);
});

test('renderer blocks a project turn, unavailable offers, foreign values and duplicate selection with zero extra mutations (CHAT-17)', async t => {
	const f = fixture();
	await f.controller.selectProject('project');
	f.reason('stop the running turn first');
	t.false(await f.controller.setConfig('model', 'requested'));
	t.deepEqual(f.writes, []);
	t.is(f.controller.getState().error, 'stop the running turn first');
	f.reason(null);
	t.false(await f.controller.setConfig('model', 'not-offered'));
	t.false(await f.controller.setConfig('provider', 'requested'));
	t.false(await f.controller.setConfig('model', 'old'));
	t.deepEqual(f.writes, []);
	const pending = deferred<IpcResult<ProjectControls>>();
	f.write(() => pending.promise);
	const changing = f.controller.setConfig('model', 'requested');
	t.false(await f.controller.setConfig('model', 'confirmed'));
	t.is(f.writes.length, 1);
	pending.resolve({ok: true, value: controls('project', 'confirmed')});
	await changing;
	f.event({
		type: 'project-controls',
		projectId: 'project',
		sequence: 1,
		controls: {
			...controls(),
			modelGate: {enabled: false, reason: 'restart Nanocoder first'},
		},
	});
	t.false(await f.controller.setConfig('model', 'requested'));
	t.is(f.writes.length, 1);
});

test('project metadata ordering is independent of high-frequency turn sequences (CHAT-19)', async t => {
	const f = fixture();
	await f.controller.selectProject('project');
	f.event({
		type: 'turn',
		projectId: 'project',
		threadId: 'thread',
		sequence: 999,
		events: [],
	});
	f.event({
		type: 'project-controls',
		projectId: 'project',
		sequence: 2,
		controls: controls('project', 'confirmed'),
	});
	f.event({
		type: 'project-controls',
		projectId: 'project',
		sequence: 1,
		controls: controls(),
	});
	t.is(f.controller.getState().controls?.revision, 'revision-confirmed');
	f.event({
		type: 'project-controls',
		projectId: 'project',
		sequence: 3,
		controls: controls('foreign'),
	});
	t.is(f.controller.getState().controls?.projectId, 'project');
});

test('late reads cannot replace a newer controls event (CHAT-04)', async t => {
	const f = fixture();
	const pending = deferred<IpcResult<ProjectControls>>();
	f.read(() => pending.promise);
	const selecting = f.controller.selectProject('project');
	f.event({
		type: 'project-controls',
		projectId: 'project',
		sequence: 1,
		controls: controls('project', 'confirmed'),
	});
	pending.resolve({ok: true, value: controls()});
	await selecting;
	t.is(f.controller.getState().controls?.revision, 'revision-confirmed');
	t.false(f.controller.getState().loading);
});

test('late old-project reads and mutations cannot populate another project (CHAT-04)', async t => {
	const f = fixture();
	const pending = deferred<IpcResult<ProjectControls>>();
	f.read(() => pending.promise);
	const selecting = f.controller.selectProject('project');
	f.read(async () => ({ok: true, value: controls('other')}));
	await f.controller.selectProject('other');
	pending.resolve({ok: true, value: controls()});
	await selecting;
	t.is(f.controller.getState().controls?.projectId, 'other');
	const mutation = deferred<IpcResult<ProjectControls>>();
	f.write(() => mutation.promise);
	const changing = f.controller.setConfig('model', 'requested');
	await f.controller.selectProject(null);
	mutation.resolve({ok: true, value: controls('other', 'confirmed')});
	await changing;
	t.is(f.controller.getState().controls, null);
	t.is(f.controller.getState().projectId, null);
	t.false(f.controller.getState().pending);
});

test('project removal and disposal discard late results and unsubscribe (CHAT-04)', async t => {
	const f = fixture();
	const pending = deferred<IpcResult<ProjectControls>>();
	f.read(() => pending.promise);
	const selecting = f.controller.selectProject('project');
	f.event({type: 'project-removed', projectId: 'project', sequence: 1});
	pending.resolve({ok: true, value: controls()});
	await selecting;
	t.is(f.controller.getState().controls, null);
	t.is(f.controller.getState().projectId, null);
	f.controller.dispose();
	t.true(f.unsubscribed());
	await f.controller.selectProject('other');
	t.deepEqual(f.reads, ['project']);
});

test('read and mutation failures preserve old values without inventing success or leaking exceptions (ACP-14)', async t => {
	const f = fixture();
	await f.controller.selectProject('project');
	f.write(async () => ({
		ok: false,
		error: {code: 'DENIED', message: 'stale model options'},
	}));
	t.false(await f.controller.setConfig('model', 'requested'));
	t.is(f.controller.getState().controls?.revision, 'revision-old');
	t.is(f.controller.getState().error, 'stale model options');
	f.write(async () => {
		throw new Error('fixture internal details');
	});
	t.false(await f.controller.setConfig('model', 'requested'));
	t.is(f.controller.getState().error, 'the model change could not finish');
	f.read(async () => {
		throw new Error('fixture internal details');
	});
	await f.controller.reload();
	t.is(f.controller.getState().error, 'project controls are unavailable');
	t.false(f.controller.getState().loading);
});
