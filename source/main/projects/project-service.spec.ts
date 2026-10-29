import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {createProjectService} from '@/main/projects/project-service';
import {desktopStoreFactory} from '@/main/store';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import type {ProjectInfo, SupervisorState} from '@/shared/ipc';

async function fixture(t: ExecutionContext) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-projects-')),
	);
	const store = await desktopStoreFactory.open({
		databasePath: path.join(root, 'desktop.sqlite'),
		driver: createNodeSqliteDriver(),
	});
	t.teardown(() => {
		store.close();
		rmSync(root, {recursive: true, force: true});
	});
	const calls: string[] = [];
	const announcements: ProjectInfo[] = [];
	let chosen: string | undefined;
	let picker: (() => Promise<string | undefined>) | undefined;
	let status: SupervisorState['status'] = 'untrusted';
	let beforeProbe: ((project: ProjectInfo) => Promise<void>) | undefined;
	let beforeStop: ((projectId: string) => Promise<void>) | undefined;
	const abort = new AbortController();
	const service = createProjectService({
		store,
		chooseRoot: () => picker?.() ?? Promise.resolve(chosen),
		signal: () => abort.signal,
		announceProject: project => announcements.push(project),
		supervisor: {
			probeProject: async project => {
				calls.push('probe');
				await beforeProbe?.(project);
				return {
					projectId: project.id,
					status,
					reason: status === 'untrusted' ? 'Trust cancelled' : null,
					runtime: null,
					agent: null,
					gates: null,
					activeThreadId: null,
					exit: null,
					restart: {attempt: 0, limit: 0, nextAttemptAt: null},
				};
			},
			stop: async projectId => {
				calls.push('stop');
				await beforeStop?.(projectId);
				return {} as SupervisorState;
			},
		},
	});
	return {
		root,
		store,
		calls,
		announcements,
		service,
		abort,
		picker: (callback: () => Promise<string | undefined>) => {
			picker = callback;
		},
		beforeStop: (callback: (projectId: string) => Promise<void>) => {
			beforeStop = callback;
		},
		outcome: (value: SupervisorState['status']) => {
			status = value;
		},
		beforeProbe: (callback: (project: ProjectInfo) => Promise<void>) => {
			beforeProbe = callback;
		},
		choose: (folder: string | undefined) => {
			chosen = folder;
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

test('picker cancellation does not save or start a project (CHAT-01)', async t => {
	const {service, store, calls} = await fixture(t);
	t.deepEqual(await service.addProject({}), {status: 'cancelled'});
	t.deepEqual(store.projects.list(), []);
	t.deepEqual(calls, []);
});

test('opening an unknown project refuses before a probe (CHAT-01)', async t => {
	const {service, calls} = await fixture(t);
	const error = await t.throwsAsync(
		service.openProject({projectId: '11111111-1111-4111-8111-111111111111'}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'NOT_FOUND');
	t.deepEqual(calls, []);
});

test('opening announces the real stored project before probing its process', async t => {
	const {root, choose, service, store, beforeProbe, announcements} =
		await fixture(t);
	const folder = path.join(root, 'project');
	mkdirSync(folder);
	choose(folder);
	const selected = await service.addProject({});
	if (selected.status !== 'selected') return t.fail();
	beforeProbe(async project => {
		t.deepEqual(announcements, [store.projects.get(project.id)]);
	});
	await service.openProject({projectId: selected.project.id});
	t.is(announcements[0]?.id, selected.project.id);
	t.is(announcements[0]?.trusted, false);
	t.is(announcements[0]?.availability, 'available');
});

for (const changed of [false, true]) {
	test(`opening a ${changed ? 'replaced' : 'missing'} root refuses before a probe (SEC-17)`, async t => {
		const {root, choose, service, store, calls} = await fixture(t);
		const folder = path.join(root, 'project');
		mkdirSync(folder);
		choose(folder);
		const added = await service.addProject({});
		if (added.status !== 'selected') return t.fail();
		renameSync(folder, `${folder}-moved`);
		if (changed)
			symlinkSync(
				`${folder}-moved`,
				folder,
				process.platform === 'win32' ? 'junction' : 'dir',
			);
		const error = await t.throwsAsync(
			service.openProject({projectId: added.project.id}),
			{instanceOf: IpcFailure},
		);
		t.is((error as IpcFailure).code, 'DENIED');
		t.false(store.projects.get(added.project.id)?.trusted);
		t.deepEqual(calls, []);
	});
}

test('an untrusted outcome keeps desktop trust false without opening a session (DEC-30)', async t => {
	const {root, choose, service, store, calls} = await fixture(t);
	choose(root);
	const added = await service.addProject({});
	if (added.status !== 'selected') return t.fail();
	store.projects.save({...added.project, trusted: true});
	t.deepEqual(await service.openProject({projectId: added.project.id}), {
		status: 'untrusted',
		message: 'Trust cancelled',
	});
	t.false(store.projects.get(added.project.id)?.trusted);
	t.deepEqual(calls, ['probe']);
});

test('a ready probe grants desktop trust and records the active recent project (CHAT-02)', async t => {
	const {root, choose, service, store, outcome, beforeProbe, calls} =
		await fixture(t);
	choose(root);
	const added = await service.addProject({});
	if (added.status !== 'selected') return t.fail();
	outcome('ready');
	store.projects.save({
		...added.project,
		lastOpenedAt: '2020-01-01T00:00:00.000Z',
	});
	beforeProbe(async project => {
		t.false(project.trusted);
		t.false(store.projects.get(project.id)?.trusted);
	});
	const result = await service.openProject({projectId: added.project.id});
	t.is(result.status, 'opened');
	t.true(store.projects.get(added.project.id)?.trusted);
	t.is(store.getUiState().activeProjectId, added.project.id);
	t.not(
		store.projects.get(added.project.id)?.lastOpenedAt,
		'2020-01-01T00:00:00.000Z',
	);
	t.deepEqual(calls, ['probe']);
});

test('a root changed during trust confirmation cannot retain a running process or gain trust (SEC-03)', async t => {
	const {root, choose, service, store, outcome, beforeProbe, calls} =
		await fixture(t);
	const folder = path.join(root, 'project');
	mkdirSync(folder);
	choose(folder);
	const added = await service.addProject({});
	if (added.status !== 'selected') return t.fail();
	outcome('ready');
	beforeProbe(async () => {
		renameSync(folder, `${folder}-moved`);
		symlinkSync(
			`${folder}-moved`,
			folder,
			process.platform === 'win32' ? 'junction' : 'dir',
		);
	});
	const error = await t.throwsAsync(
		service.openProject({projectId: added.project.id}),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
	t.false(store.projects.get(added.project.id)?.trusted);
	t.deepEqual(calls, ['probe', 'stop']);
});

test('adding a symlinked non-Git folder saves its canonical root and equal session cwd (CHAT-01)', async t => {
	const {root, choose, service, store, calls} = await fixture(t);
	const folder = path.join(root, 'project');
	mkdirSync(folder);
	const link = path.join(root, 'alias');
	symlinkSync(folder, link, process.platform === 'win32' ? 'junction' : 'dir');
	choose(link);
	const result = await service.addProject({});
	t.is(result.status, 'selected');
	if (result.status !== 'selected') return;
	t.is(result.project.canonicalRoot, folder);
	t.is(result.project.sessionCwd, folder);
	t.is(result.project.displayName, 'project');
	t.regex(result.project.id, /^[\da-f-]{36}$/);
	t.false(result.project.trusted);
	t.is(result.project.defaultMode, 'normal');
	t.deepEqual(store.projects.get(result.project.id), result.project);
	t.deepEqual(calls, []);
});

for (const kind of ['missing', 'file', 'relative'] as const) {
	test(`adding a ${kind} picker result is refused without saving or launching (SEC-03)`, async t => {
		const {root, choose, service, store, calls} = await fixture(t);
		const selected = kind === 'relative' ? '.' : path.join(root, kind);
		if (kind === 'file') writeFileSync(selected, 'fixture');
		choose(selected);
		const error = await t.throwsAsync(service.addProject({}), {
			instanceOf: IpcFailure,
		});
		t.is((error as IpcFailure).code, 'DENIED');
		t.deepEqual(store.projects.list(), []);
		t.deepEqual(calls, []);
	});
}

test('adding the same canonical folder reuses its project without changing recency (CHAT-01)', async t => {
	const {root, choose, service, store} = await fixture(t);
	choose(root);
	const first = await service.addProject({});
	t.is(first.status, 'selected');
	const second = await service.addProject({});
	t.deepEqual(second, first);
	t.is(store.projects.list().length, 1);
});

test('locating a moved project stops its old process before changing paths and clears trust (CHAT-01)', async t => {
	const {root, choose, service, store, calls, beforeStop} = await fixture(t);
	const old = path.join(root, 'old');
	const moved = path.join(root, 'moved');
	mkdirSync(old);
	choose(old);
	const added = await service.addProject({});
	if (added.status !== 'selected') return t.fail();
	store.projects.save({...added.project, trusted: true});
	renameSync(old, moved);
	const link = path.join(root, 'new-alias');
	symlinkSync(moved, link, process.platform === 'win32' ? 'junction' : 'dir');
	beforeStop(async id => {
		t.is(store.projects.get(id)?.canonicalRoot, old);
	});
	choose(link);
	const result = await service.locateProject({projectId: added.project.id});
	t.is(result.status, 'selected');
	if (result.status !== 'selected') return;
	t.is(result.project.id, added.project.id);
	t.is(result.project.createdAt, added.project.createdAt);
	t.is(result.project.canonicalRoot, moved);
	t.is(result.project.sessionCwd, moved);
	t.false(result.project.trusted);
	t.deepEqual(calls, ['stop']);
});

for (const kind of ['cancelled', 'missing', 'file', 'duplicate'] as const) {
	test(`a ${kind} locate selection leaves the original project untouched (SEC-03)`, async t => {
		const {root, choose, service, store, calls} = await fixture(t);
		choose(root);
		const added = await service.addProject({});
		if (added.status !== 'selected') return t.fail();
		const target = path.join(root, kind);
		if (kind === 'file') writeFileSync(target, 'fixture');
		if (kind === 'duplicate') {
			mkdirSync(target);
			choose(target);
			await service.addProject({});
		}
		choose(kind === 'cancelled' ? undefined : target);
		if (kind === 'cancelled') {
			t.deepEqual(await service.locateProject({projectId: added.project.id}), {
				status: 'cancelled',
			});
		} else {
			const error = await t.throwsAsync(
				service.locateProject({projectId: added.project.id}),
				{instanceOf: IpcFailure},
			);
			t.is((error as IpcFailure).code, 'DENIED');
		}
		t.deepEqual(store.projects.get(added.project.id), added.project);
		t.deepEqual(calls, []);
	});
}

test('concurrent picker operations are refused rather than opening another dialog (SEC-17)', async t => {
	const {service, picker, store} = await fixture(t);
	const entered = deferred<void>();
	const selected = deferred<string | undefined>();
	let first = true;
	picker(() => {
		if (!first) return Promise.resolve(undefined);
		first = false;
		entered.resolve();
		return selected.promise;
	});
	const pending = service.addProject({});
	await entered.promise;
	try {
		const error = await t.throwsAsync(service.addProject({}), {
			instanceOf: IpcFailure,
		});
		t.is((error as IpcFailure).code, 'BUSY');
	} finally {
		selected.resolve(undefined);
		await pending;
	}
	t.is(store.projects.list().length, 0);
});

test('a late picker selection after renderer detachment cannot save or launch (SEC-17)', async t => {
	const {root, service, picker, abort, store, calls} = await fixture(t);
	const selected = deferred<string | undefined>();
	picker(() => selected.promise);
	const request = service.addProject({});
	abort.abort();
	selected.resolve(root);
	const error = await t.throwsAsync(request, {instanceOf: IpcFailure});
	t.is((error as IpcFailure).code, 'AGENT_UNAVAILABLE');
	t.is(store.projects.list().length, 0);
	t.deepEqual(calls, []);
});

test('picker failures return a fixed refusal without exposing their inputs (SEC-07)', async t => {
	const {service, picker} = await fixture(t);
	picker(async () => {
		throw new Error('fixture-sensitive-value');
	});
	const error = await t.throwsAsync(service.addProject({}), {
		instanceOf: IpcFailure,
	});
	t.false(error?.message.includes('fixture-sensitive-value'));
});
