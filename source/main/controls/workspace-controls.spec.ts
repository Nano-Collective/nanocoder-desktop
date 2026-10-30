import {randomUUID} from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {createWorkspaceControls} from '@/main/controls/workspace-controls';
import {IpcFailure} from '@/main/ipc/handle-request';
import {fakeEvents} from '@/main/nanocoder/fixtures/fake-project';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {desktopStoreFactory} from '@/main/store';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import {createThreadService} from '@/main/threads/thread-service';
import type {ProjectControls, ProjectInfo, ThreadInfo} from '@/shared/ipc';

async function fixture(t: ExecutionContext, scenario?: string) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-controls-')),
	);
	const projectRoot = path.join(root, 'project');
	mkdirSync(projectRoot);
	if (scenario)
		writeFileSync(path.join(projectRoot, '.fake-nanocoder'), scenario);
	const store = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	const project: ProjectInfo = {
		id: randomUUID(),
		canonicalRoot: projectRoot,
		sessionCwd: projectRoot,
		displayName: 'fixture project',
		trusted: true,
		defaultMode: 'normal',
		createdAt: '2026-10-30T12:00:00.000Z',
		lastOpenedAt: '2026-10-30T12:00:00.000Z',
		availability: 'available',
	};
	store.projects.save(project);
	let launches = 0;
	const supervisor = new ProjectSupervisor({
		resolveRuntime: async () => {
			launches++;
			return {
				ok: true,
				runtime: {
					nodePath: process.execPath,
					cliPath: path.join(
						import.meta.dirname,
						'../nanocoder/fixtures/fake-control-nanocoder.mjs',
					),
					version: '9.9.9',
					nodeVersion: process.version,
					source: 'override',
				},
			};
		},
		clientInfo: {name: 'controls-fixture', version: '0.0.0'},
		confirmTrust: async () => false,
	});
	let controls!: ReturnType<typeof createWorkspaceControls>;
	const threads = createThreadService({
		store,
		supervisor,
		onSessionPrepared: context => controls.hooks.onSessionPrepared(context),
		beforeFirstPrompt: context => controls.hooks.beforeFirstPrompt(context),
		validateBeforePrepare: (lease, thread) =>
			controls.hooks.validateBeforePrepare(lease, thread),
		resolveLiveMode: (...args) => controls.hooks.resolveLiveMode(...args),
	});
	const published: ProjectControls[] = [];
	const writes: ThreadInfo[] = [];
	const saveThread = store.threads.save;
	store.threads.save = thread => {
		writes.push(structuredClone(thread));
		saveThread(thread);
	};
	let confirm = async () => true;
	let confirmations = 0;
	controls = createWorkspaceControls({
		store,
		threads,
		getConnection: id => {
			try {
				return supervisor.getConnection(id);
			} catch {
				return undefined;
			}
		},
		publishControls: value => {
			published.push(value);
			supervisor.publishControls(value);
		},
		publishThread: thread => supervisor.publishThread(thread),
		publishProject: owner => supervisor.announceProject(owner),
		confirmYolo: async () => {
			confirmations++;
			return confirm();
		},
	});
	t.teardown(async () => {
		await supervisor.close();
		controls.dispose();
		threads.dispose();
		store.close();
		rmSync(root, {recursive: true, force: true});
	});
	const thread = await threads.createThread({projectId: project.id});
	const request = {projectId: project.id, threadId: thread.id};
	return {
		store,
		supervisor,
		threads,
		controls,
		project,
		thread,
		request,
		writes,
		published,
		launches: () => launches,
		confirmations: () => confirmations,
		confirm: (next: typeof confirm) => {
			confirm = next;
		},
		rpc: () => fakeEvents(supervisor.getConnection(project.id).stderr.lines()),
	};
}

test('composed first send keeps pending yolo memory-only and orders safe acknowledgement, identity, yolo and prompt (CHAT-04 DEC-31)', async t => {
	const f = await fixture(t);
	const initial = f.controls.controls.getProjectControls({
		projectId: f.project.id,
	});
	t.false(initial.modelGate.enabled);
	t.is(
		(await f.controls.setThreadMode({...f.request, mode: 'yolo'})).mode,
		'yolo',
	);
	t.is(f.launches(), 0);
	t.is((await f.threads.getThreadSnapshot(f.request)).thread.mode, 'yolo');
	t.is(f.store.threads.get(f.project.id, f.thread.id)?.mode, 'normal');
	await f.threads.promptThread({...f.request, text: 'fixture request'});
	t.deepEqual(
		f
			.rpc()
			.filter(event =>
				['session/new', 'session/set_mode', 'session/prompt'].includes(
					String(event.method),
				),
			)
			.map(event => [event.method, (event.params as {modeId?: string}).modeId]),
		[
			['session/new', undefined],
			['session/set_mode', 'normal'],
			['session/set_mode', 'yolo'],
			['session/prompt', undefined],
		],
	);
	t.is(f.confirmations(), 1);
	t.true(f.writes.every(thread => thread.mode !== 'yolo'));
	t.is((await f.threads.getThreadSnapshot(f.request)).thread.mode, 'yolo');
	t.true(
		f.controls.controls.getProjectControls({projectId: f.project.id}).modelGate
			.enabled,
	);
});

test('composed offers come from another owned project thread and provider success returns the actual selected model (CHAT-10)', async t => {
	const f = await fixture(t);
	await f.threads.promptThread({...f.request, text: 'fixture'});
	const other = await f.threads.createThread({projectId: f.project.id});
	t.is(other.nanocoderSessionId, null);
	const offered = f.controls.controls.getProjectControls({
		projectId: f.project.id,
	});
	t.true(offered.modelGate.enabled);
	const confirmed = await f.controls.controls.setProjectConfigOption({
		projectId: f.project.id,
		revision: offered.revision,
		configId: 'provider',
		value: 'b',
	});
	t.is(
		confirmed.configOptions.find(option => option.id === 'model')?.currentValue,
		'confirmed',
	);
	t.is(f.rpc().filter(event => event.method === 'session/new').length, 1);
	t.is(
		f.rpc().filter(event => event.method === 'session/set_config_option')
			.length,
		1,
	);
	t.is(f.store.threads.get(f.project.id, other.id)?.nanocoderSessionId, null);
});

test('composed config uncertainty blocks every later prompt before content, not just the first prompt (ACP-14)', async t => {
	const f = await fixture(t, 'config-fails');
	await f.threads.promptThread({...f.request, text: 'first fixture'});
	await f.threads.promptThread({...f.request, text: 'second fixture'});
	const offered = f.controls.controls.getProjectControls({
		projectId: f.project.id,
	});
	await t.throwsAsync(
		f.controls.controls.setProjectConfigOption({
			projectId: f.project.id,
			revision: offered.revision,
			configId: 'provider',
			value: 'b',
		}),
	);
	const before = await f.threads.getThreadSnapshot(f.request);
	await t.throwsAsync(
		f.threads.promptThread({...f.request, text: 'blocked fixture'}),
		{instanceOf: IpcFailure},
	);
	const after = await f.threads.getThreadSnapshot(f.request);
	t.deepEqual(after.events, before.events);
	t.is(f.rpc().filter(event => event.method === 'session/prompt').length, 2);
});
