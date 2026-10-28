import {randomUUID} from 'node:crypto';
import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {desktopStoreFactory} from '@/main/store';
import type {SqlDatabase, SqlDriver} from '@/main/store/contracts';
import {
	migrate,
	migrations,
	schemaVersion,
	transaction,
} from '@/main/store/migrations';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import type {ProjectInfo, ThreadInfo} from '@/shared/ipc';

function fixture(t: ExecutionContext) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-store-')),
	);
	t.teardown(() => rmSync(root, {recursive: true, force: true}));
	const filename = path.join(root, 'desktop.sqlite');
	const driver = createNodeSqliteDriver();
	const open = async () => {
		const store = await desktopStoreFactory.open({
			databasePath: filename,
			driver,
		});
		t.teardown(() => store.close());
		return store;
	};
	return {root, filename, driver, open};
}

function project(
	root: string,
	overrides: Partial<ProjectInfo> = {},
): ProjectInfo {
	return {
		id: randomUUID(),
		canonicalRoot: root,
		sessionCwd: root,
		displayName: 'fixture',
		trusted: false,
		defaultMode: 'normal',
		lastOpenedAt: '2026-10-29T12:00:00.000Z',
		createdAt: '2026-10-29T12:00:00.000Z',
		availability: 'available',
		...overrides,
	};
}

function thread(
	owner: ProjectInfo,
	overrides: Partial<ThreadInfo> = {},
): ThreadInfo {
	return {
		id: randomUUID(),
		projectId: owner.id,
		nanocoderSessionId: randomUUID(),
		title: 'fixture thread',
		archiveState: 'active',
		runState: 'ready',
		lastActivityAt: '2026-10-29T12:00:00.000Z',
		sessionCwd: owner.sessionCwd,
		mode: 'normal',
		viewOnlyReason: null,
		...overrides,
	};
}

test('empty database runs every numbered migration and persists the version', async t => {
	const f = fixture(t);
	const store = await f.open();
	store.close();
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	t.is(schemaVersion(db), migrations.length);
	t.deepEqual(
		db
			.prepare('SELECT version FROM schema_migration ORDER BY version')
			.all()
			.map(row => row.version),
		[1, 2],
	);
	t.false(readdirSync(f.root).some(name => name.includes('.backup-')));
	if (process.platform !== 'win32')
		t.is(statSync(f.filename).mode & 0o777, 0o600);
});

test('all migrated tables are introspected and have no content-bearing column', async t => {
	const f = fixture(t);
	(await f.open()).close();
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	const tables = db
		.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
		.all();
	t.is(tables.length, 9);
	let columns = 0;
	for (const table of tables) {
		const fields = db
			.prepare('SELECT name FROM pragma_table_info(?)')
			.all(table.name);
		t.true(fields.length > 0);
		for (const field of fields) {
			columns++;
			t.notRegex(
				String(field.name),
				/message|transcript|content|payload|output|stderr|scrollback|secret|credential|password|token|prompt|screenshot/i,
			);
		}
	}
	t.true(columns > 40);
});

test('previous version is backed up before upgrade with metadata preserved', async t => {
	const f = fixture(t);
	const previous = f.driver.open(f.filename);
	t.teardown(() => previous.close());
	previous.exec('PRAGMA journal_mode = WAL');
	transaction(previous, () => {
		previous.exec(migrations[0].sql);
		previous
			.prepare('INSERT INTO schema_migration VALUES (?, ?)')
			.run(1, '2026-10-28T12:00:00.000Z');
		previous.exec('PRAGMA user_version = 1');
		previous
			.prepare('INSERT INTO setting VALUES (?, ?)')
			.run('theme', '"light"');
	});
	t.true(statSync(`${f.filename}-wal`).size > 0);
	const calls: string[] = [];
	const wrapped: SqlDriver = {
		open: filename => f.driver.open(filename),
		backup: async (database, filename) => {
			t.is(schemaVersion(database), 1);
			calls.push(filename);
			await f.driver.backup(database, filename);
		},
	};
	const store = await desktopStoreFactory.open({
		databasePath: f.filename,
		driver: wrapped,
	});
	t.teardown(() => store.close());
	t.is(store.getSettings().theme, 'light');
	t.is(calls.length, 1);
	const backup = f.driver.open(calls[0]);
	t.teardown(() => backup.close());
	t.is(schemaVersion(backup), 1);
	t.is(
		backup.prepare('SELECT value FROM setting WHERE key = ?').get('theme')
			?.value,
		'"light"',
	);
	t.is(
		backup
			.prepare(
				"SELECT count(*) AS n FROM sqlite_schema WHERE name = 'ui_state'",
			)
			.get()?.n,
		0,
	);
	store.close();
	(await f.open()).close();
	t.is(
		readdirSync(f.root).filter(name => /\.backup-[\da-f-]+$/.test(name)).length,
		1,
	);
});

test('an existing empty database is backed up before its first migration', async t => {
	const f = fixture(t);
	f.driver.open(f.filename).close();
	(await f.open()).close();
	const files = readdirSync(f.root).filter(name => name.includes('.backup-'));
	t.is(files.length, 1);
	const backup = f.driver.open(path.join(f.root, files[0]));
	t.teardown(() => backup.close());
	t.is(schemaVersion(backup), 0);
});

test('a newer database is refused without backup, migration or quarantine', async t => {
	const f = fixture(t);
	const db = f.driver.open(f.filename);
	db.exec('PRAGMA user_version = 999');
	db.close();
	const before = readFileSync(f.filename);
	await t.throwsAsync(f.open, {instanceOf: IpcFailure, code: 'STORE_TOO_NEW'});
	t.deepEqual(readFileSync(f.filename), before);
	t.deepEqual(readdirSync(f.root), ['desktop.sqlite']);
});

test('a newer migration record is refused even if user_version is stale', async t => {
	const f = fixture(t);
	(await f.open()).close();
	const db = f.driver.open(f.filename);
	db.prepare('INSERT INTO schema_migration VALUES (?, ?)').run(
		999,
		'2026-10-29T12:00:00.000Z',
	);
	db.exec('PRAGMA user_version = 0');
	db.close();
	await t.throwsAsync(f.open, {code: 'STORE_TOO_NEW'});
	t.false(readdirSync(f.root).some(name => name.includes('.corrupt-')));
});

test('a failed migration rolls back its schema and recorded version', t => {
	const f = fixture(t);
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	const injected: SqlDatabase = {
		...db,
		exec: sql => {
			if (sql === 'PRAGMA user_version = 2')
				throw new IpcFailure('INTERNAL', 'fixture migration failure');
			db.exec(sql);
		},
	};
	t.throws(() => migrate(injected, 0), {code: 'INTERNAL'});
	t.is(schemaVersion(db), 1);
	t.is(
		db
			.prepare(
				"SELECT count(*) AS n FROM sqlite_schema WHERE name = 'ui_state'",
			)
			.get()?.n,
		0,
	);
});

test('backup failure stops the upgrade and closes the connection', async t => {
	const f = fixture(t);
	f.driver.open(f.filename).close();
	let closed = false;
	const driver: SqlDriver = {
		open: filename => {
			const db = f.driver.open(filename);
			return {
				...db,
				close: () => {
					closed = true;
					db.close();
				},
			};
		},
		backup: async () => {
			throw new Error('fixture sensitive details');
		},
	};
	const error = await t.throwsAsync(
		() => desktopStoreFactory.open({databasePath: f.filename, driver}),
		{code: 'INTERNAL'},
	);
	t.false(error?.message.includes('sensitive'));
	t.true(closed);
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	t.is(schemaVersion(db), 0);
});

test('corrupt bytes are moved aside and a fresh database starts', async t => {
	const f = fixture(t);
	const bytes = Buffer.from('fixture invalid SQLite bytes');
	writeFileSync(f.filename, bytes);
	const store = await f.open();
	t.is(store.getSettings().defaultMode, 'normal');
	t.deepEqual(store.projects.list(), []);
	const directory = readdirSync(f.root).find(name =>
		name.includes('.corrupt-'),
	);
	t.truthy(directory);
	t.deepEqual(
		readFileSync(path.join(f.root, directory as string, 'desktop.sqlite')),
		bytes,
	);
	store.close();
	(await f.open()).close();
	t.is(
		readdirSync(f.root).filter(name => name.includes('.corrupt-')).length,
		1,
	);
});

test('an integrity-check failure preserves the database and sidecars together', async t => {
	const f = fixture(t);
	writeFileSync(f.filename, 'fixture db');
	writeFileSync(`${f.filename}-wal`, 'fixture wal');
	writeFileSync(`${f.filename}-shm`, 'fixture shm');
	writeFileSync(`${f.filename}-journal`, 'fixture journal');
	let first = true;
	const driver: SqlDriver = {
		...f.driver,
		open: filename => {
			if (!first) return f.driver.open(filename);
			first = false;
			return {
				exec: () => {},
				prepare: () => ({
					get: () => undefined,
					run: () => ({changes: 0}),
					all: () => [{integrity_check: 'fixture corruption'}],
				}),
				close: () => {},
			};
		},
	};
	const store = await desktopStoreFactory.open({
		databasePath: f.filename,
		driver,
	});
	t.teardown(() => store.close());
	const directory = readdirSync(f.root).find(name =>
		name.includes('.corrupt-'),
	) as string;
	t.deepEqual(readdirSync(path.join(f.root, directory)).sort(), [
		'desktop.sqlite',
		'desktop.sqlite-journal',
		'desktop.sqlite-shm',
		'desktop.sqlite-wal',
	]);
	t.deepEqual(store.projects.list(), []);
});

test('invalid migration records are quarantined rather than partially upgraded', async t => {
	const f = fixture(t);
	(await f.open()).close();
	const db = f.driver.open(f.filename);
	db.prepare('DELETE FROM schema_migration WHERE version = ?').run(1);
	db.close();
	(await f.open()).close();
	t.true(readdirSync(f.root).some(name => name.includes('.corrupt-')));
});

test('settings and bounded UI state persist across close and reopen', async t => {
	const f = fixture(t);
	const store = await f.open();
	t.deepEqual(store.getSettings(), {
		publicBrowsingEnabled: false,
		defaultMode: 'normal',
		editor: 'system',
		nanocoderOverridePath: null,
		theme: 'dark',
	});
	const settings = store.updateSettings({
		publicBrowsingEnabled: true,
		defaultMode: 'plan',
		editor: 'code',
		theme: 'light',
	});
	const state = store.updateUiState({
		window: {width: 1240, height: 840, x: -100, y: 20, maximised: true},
		activeProjectId: randomUUID(),
		activeThreadId: randomUUID(),
		openThreadIds: [randomUUID()],
		inspector: 'review',
		bottomPanel: 'terminal',
	});
	t.is(store.updateSettings({}).theme, 'light');
	t.deepEqual(store.updateUiState({}), state);
	store.close();
	const next = await f.open();
	t.deepEqual(next.getSettings(), settings);
	t.deepEqual(next.getUiState(), state);
	const detached = next.getUiState();
	detached.openThreadIds.push(randomUUID());
	t.deepEqual(next.getUiState(), state);
});

test('main can store a canonical runtime override but unavailable and relative paths are refused', async t => {
	const f = fixture(t);
	const store = await f.open();
	const executable = path.join(f.root, 'fixture-cli.js');
	writeFileSync(executable, '');
	t.is(
		store.updateSettings({nanocoderOverridePath: executable})
			.nanocoderOverridePath,
		executable,
	);
	t.throws(() => store.updateSettings({nanocoderOverridePath: 'relative.js'}), {
		code: 'VALIDATION',
	});
	t.throws(
		() =>
			store.updateSettings({
				nanocoderOverridePath: path.join(f.root, 'missing'),
			}),
		{code: 'VALIDATION'},
	);
	t.throws(() => store.updateSettings({nanocoderOverridePath: f.root}), {
		code: 'VALIDATION',
	});
	t.is(
		store.updateSettings({nanocoderOverridePath: null}).nanocoderOverridePath,
		null,
	);
});

test('the store refuses secrets, transcripts, payloads, arbitrary fields and unsafe defaults before writing', async t => {
	const f = fixture(t);
	const store = await f.open();
	const marker = 'fixture-never-persist-this-content';
	const before = store.getSettings();
	for (const key of [
		'apiKey',
		'oauthToken',
		'messages',
		'fileContents',
		'toolOutput',
		'stderr',
		'draft',
	]) {
		t.throws(() => store.updateSettings({[key]: marker} as never), {
			code: 'VALIDATION',
		});
		t.throws(() => store.updateUiState({[key]: marker} as never), {
			code: 'VALIDATION',
		});
	}
	t.throws(() => store.updateSettings({defaultMode: 'yolo'} as never), {
		code: 'VALIDATION',
	});
	t.throws(() => store.updateUiState({window: {width: 100_000}} as never), {
		code: 'VALIDATION',
	});
	t.throws(
		() =>
			store.updateUiState({
				openThreadIds: Array.from({length: 101}, () => randomUUID()),
			}),
		{code: 'VALIDATION'},
	);
	t.throws(
		() =>
			store.updateUiState({
				window: {...store.getUiState().window, content: marker},
			} as never),
		{code: 'VALIDATION'},
	);
	t.deepEqual(store.getSettings(), before);
	store.close();
	for (const file of readdirSync(f.root)) {
		if (statSync(path.join(f.root, file)).isFile())
			t.false(readFileSync(path.join(f.root, file)).includes(marker));
	}
});

test('database paths cannot be relative, symlinks, directories or hard links', async t => {
	const f = fixture(t);
	const open = (filename: string) =>
		desktopStoreFactory.open({databasePath: filename, driver: f.driver});
	await t.throwsAsync(() => open('relative.sqlite'), {code: 'VALIDATION'});
	await t.throwsAsync(() => open(`${f.filename}\0`), {code: 'VALIDATION'});
	await t.throwsAsync(() => open(f.root), {code: 'DENIED'});
	const target = path.join(f.root, 'target');
	writeFileSync(target, 'fixture unchanged');
	symlinkSync(target, f.filename);
	await t.throwsAsync(f.open, {code: 'DENIED'});
	t.is(readFileSync(target, 'utf8'), 'fixture unchanged');
	rmSync(f.filename);
	linkSync(target, f.filename);
	await t.throwsAsync(f.open, {code: 'DENIED'});
	t.is(readFileSync(target, 'utf8'), 'fixture unchanged');
});

test('SQLite sidecars cannot redirect writes through symlinks', async t => {
	const f = fixture(t);
	const target = path.join(f.root, 'target');
	writeFileSync(target, 'fixture unchanged');
	for (const suffix of ['-wal', '-shm', '-journal']) {
		symlinkSync(target, f.filename + suffix);
		await t.throwsAsync(f.open, {code: 'DENIED'});
		rmSync(f.filename + suffix);
	}
	t.is(readFileSync(target, 'utf8'), 'fixture unchanged');
});

test('a symlinked user-data directory is canonicalised and keeps the database inside it', async t => {
	const f = fixture(t);
	const actual = path.join(f.root, 'actual');
	const linked = path.join(f.root, 'linked');
	mkdirSync(actual);
	symlinkSync(
		actual,
		linked,
		process.platform === 'win32' ? 'junction' : 'dir',
	);
	const store = await desktopStoreFactory.open({
		databasePath: path.join(linked, 'desktop.sqlite'),
		driver: f.driver,
	});
	t.teardown(() => store.close());
	store.updateSettings({theme: 'light'});
	t.true(readdirSync(actual).every(name => name.startsWith('desktop.sqlite')));
	t.true(readdirSync(actual).includes('desktop.sqlite'));
});

test('driver errors never expose SQLite inputs or filenames and foreign adapters are refused', async t => {
	const f = fixture(t);
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	t.throws(() => db.exec('fixture sensitive invalid SQL'), {
		code: 'INTERNAL',
		message: 'The desktop database could not complete the operation',
	});
	t.throws(() => db.prepare('fixture sensitive invalid SQL'), {
		code: 'INTERNAL',
	});
	await t.throwsAsync(
		() => f.driver.backup({...db}, path.join(f.root, 'backup')),
		{code: 'INTERNAL'},
	);
	await t.throwsAsync(
		() => f.driver.backup(db, path.join(f.root, 'missing', 'backup')),
		{code: 'INTERNAL'},
	);
	t.throws(() => f.driver.open(f.root), {code: 'INTERNAL'});
});

test('project and thread repositories round-trip metadata, sort, scope and remove desktop rows only', async t => {
	const f = fixture(t);
	const store = await f.open();
	const one = project(f.root);
	const otherRoot = path.join(f.root, 'other');
	mkdirSync(otherRoot);
	const two = project(otherRoot, {lastOpenedAt: '2026-10-29T13:00:00.000Z'});
	store.projects.save(one);
	store.projects.save(two);
	t.deepEqual(store.projects.list(), [two, one]);
	t.deepEqual(store.projects.get(one.id), one);
	t.is(store.projects.get(randomUUID()), undefined);
	const first = thread(one);
	const latest = thread(one, {lastActivityAt: '2026-10-29T13:00:00.000Z'});
	const archived = thread(one, {archiveState: 'archived'});
	for (const row of [first, latest, archived]) store.threads.save(row);
	t.deepEqual(store.threads.list(one.id, 'active'), [latest, first]);
	t.deepEqual(store.threads.list(one.id, 'archived'), [archived]);
	t.is(store.threads.get(two.id, first.id), undefined);
	store.threads.remove(two.id, first.id);
	t.deepEqual(store.threads.get(one.id, first.id), first);
	store.threads.save({...first, title: 'renamed', runState: 'running'});
	t.is(store.threads.get(one.id, first.id)?.title, 'renamed');
	store.projects.save({...one, displayName: 'renamed project', trusted: true});
	t.is(store.projects.get(one.id)?.displayName, 'renamed project');
	store.close();
	const reopened = await f.open();
	t.is(reopened.threads.get(one.id, first.id)?.runState, 'running');
	reopened.threads.remove(one.id, first.id);
	t.is(reopened.threads.get(one.id, first.id), undefined);
	const sessionFile = path.join(f.root, 'fixture-session.json');
	writeFileSync(sessionFile, '{}');
	reopened.projects.remove(one.id);
	t.deepEqual(reopened.threads.list(one.id, 'active'), []);
	t.deepEqual(reopened.threads.list(one.id, 'archived'), []);
	t.is(readFileSync(sessionFile, 'utf8'), '{}');
	t.deepEqual(reopened.projects.list(), [two]);
});

test('repositories refuse content fields, unsafe defaults, cross-project moves and path escapes', async t => {
	const f = fixture(t);
	const store = await f.open();
	const owner = project(f.root, {defaultMode: 'plan'});
	store.projects.save(owner);
	t.throws(
		() => store.projects.save({...owner, defaultMode: 'yolo'} as never),
		{code: 'VALIDATION'},
	);
	t.throws(
		() => store.projects.save({...owner, messages: ['fixture']} as never),
		{code: 'VALIDATION'},
	);
	t.throws(() => store.projects.save({...owner, sessionCwd: tmpdir()}), {
		code: 'OUTSIDE_ROOT',
	});
	t.throws(
		() =>
			store.projects.save({
				...owner,
				canonicalRoot: path.join(f.root, 'missing'),
			}),
		{code: 'DENIED'},
	);
	const row = thread(owner, {mode: 'yolo'});
	store.threads.save(row);
	t.is(store.threads.get(owner.id, row.id)?.mode, 'plan');
	t.throws(() => store.threads.save({...row, toolOutput: 'fixture'} as never), {
		code: 'VALIDATION',
	});
	t.throws(() => store.threads.save({...row, projectId: randomUUID()}), {
		code: 'NOT_FOUND',
	});
	t.throws(
		() =>
			store.threads.save({...row, sessionCwd: realpathSync.native(tmpdir())}),
		{code: 'OUTSIDE_ROOT'},
	);
	const two = project(f.root, {id: randomUUID()});
	const sub = path.join(f.root, 'sub');
	mkdirSync(sub);
	store.projects.save({...two, canonicalRoot: sub, sessionCwd: sub});
	t.throws(() => store.threads.save({...row, projectId: two.id}), {
		code: 'DENIED',
	});
	t.throws(
		() =>
			store.threads.save({
				...row,
				id: randomUUID(),
				nanocoderSessionId: row.nanocoderSessionId,
			}),
		{code: 'INTERNAL'},
	);
});

test('repositories mark missing and replaced roots without following them', async t => {
	const f = fixture(t);
	const store = await f.open();
	const root = path.join(f.root, 'project');
	const moved = path.join(f.root, 'moved');
	mkdirSync(root);
	const row = project(root);
	store.projects.save(row);
	renameSync(root, moved);
	t.is(store.projects.get(row.id)?.availability, 'missing');
	symlinkSync(moved, root, process.platform === 'win32' ? 'junction' : 'dir');
	t.is(store.projects.get(row.id)?.availability, 'changed');
	t.throws(() => store.projects.save(row), {code: 'DENIED'});
});

test('foreign keys cascade metadata for turns, agents, terminal and browser', async t => {
	const f = fixture(t);
	const store = await f.open();
	const owner = project(f.root);
	const row = thread(owner);
	store.projects.save(owner);
	store.threads.save(row);
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	db.prepare('INSERT INTO turn_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
		randomUUID(),
		row.id,
		'completed',
		'[]',
		row.lastActivityAt,
		row.lastActivityAt,
		null,
		null,
	);
	db.prepare('INSERT INTO agent_run VALUES (?, ?, ?, ?, ?, ?)').run(
		randomUUID(),
		row.id,
		null,
		null,
		'explore',
		'completed',
	);
	db.prepare('INSERT INTO terminal_session VALUES (?, ?, ?, ?)').run(
		randomUUID(),
		owner.id,
		f.root,
		'stopped',
	);
	db.prepare('INSERT INTO browser_tab VALUES (?, ?, ?, ?)').run(
		randomUUID(),
		owner.id,
		'http://localhost/',
		'fixture',
	);
	t.throws(
		() =>
			db
				.prepare('INSERT INTO setting VALUES (?, ?)')
				.run('apiKey', '"fixture"'),
		{code: 'INTERNAL'},
	);
	store.projects.remove(owner.id);
	for (const table of [
		'thread',
		'turn_summary',
		'agent_run',
		'terminal_session',
		'browser_tab',
	]) {
		t.is(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
	}
});
