import {spawnSync} from 'node:child_process';
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
import {repositories} from '@/main/store/repositories';
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

test('opening a store reconciles only orphaned running and waiting rows, preserving all other metadata and manual titles (CHAT-03, DATA-07)', async t => {
	const f = fixture(t);
	const store = await f.open();
	const owner = project(f.root);
	store.projects.save(owner);
	const rows = (
		[
			'new',
			'ready',
			'running',
			'waiting-approval',
			'interrupted',
			'failed',
			'view-only',
		] as const
	).flatMap((runState, index) =>
		(['active', 'archived'] as const).map(archiveState => {
			const row = thread(owner, {
				runState,
				archiveState,
				nanocoderSessionId: runState === 'new' ? null : randomUUID(),
				title: `${runState} fixture`,
				viewOnlyReason:
					runState === 'view-only' ? 'fixture history unavailable' : null,
			});
			store.threads.save(row);
			store.threads.setTitle({
				projectId: owner.id,
				threadId: row.id,
				title: row.title,
				manuallySet: index % 2 === 0,
			});
			return {row, manuallySet: index % 2 === 0};
		}),
	);
	for (const {row} of rows)
		t.deepEqual(store.threads.get(owner.id, row.id), row);
	store.close();
	const reopened = await f.open();
	for (const {row, manuallySet} of rows) {
		t.deepEqual(reopened.threads.get(owner.id, row.id), {
			...row,
			runState: ['running', 'waiting-approval'].includes(row.runState)
				? 'interrupted'
				: row.runState,
		});
		t.is(reopened.threads.getTitleManuallySet(owner.id, row.id), manuallySet);
	}
});

function legacyMetadata(f: ReturnType<typeof fixture>, version: 1 | 2) {
	const database = f.driver.open(f.filename);
	const owner = project(f.root);
	const saved = thread(owner);
	try {
		for (const migration of migrations.slice(0, version))
			transaction(database, () => {
				database.exec(migration.sql);
				database
					.prepare('INSERT INTO schema_migration VALUES (?, ?)')
					.run(migration.version, '2026-10-29T12:00:00.000Z');
				database.exec(`PRAGMA user_version = ${migration.version}`);
			});
		const legacy = repositories(database);
		legacy.projects.save(owner);
		legacy.threads.save(saved);
	} finally {
		database.close();
	}
	return {owner, saved};
}

for (const version of [1, 2] as const)
	test(`upgrading a real 00${version} database protects existing titles and backs up once (CHAT-12)`, async t => {
		const f = fixture(t);
		const {owner, saved} = legacyMetadata(f, version);
		const backups: string[] = [];
		const store = await desktopStoreFactory.open({
			databasePath: f.filename,
			driver: {
				open: f.driver.open,
				backup: async (database, filename) => {
					t.is(schemaVersion(database), version);
					backups.push(filename);
					await f.driver.backup(database, filename);
				},
			},
		});
		t.teardown(() => store.close());
		t.true(store.threads.getTitleManuallySet(owner.id, saved.id));
		t.deepEqual(store.threads.get(owner.id, saved.id), saved);
		t.is(backups.length, 1);
		const backup = f.driver.open(backups[0]);
		try {
			t.is(schemaVersion(backup), version);
			t.false(
				backup
					.prepare('PRAGMA table_info(thread)')
					.all()
					.some(column => column.name === 'title_manually_set'),
			);
			t.is(
				backup.prepare('SELECT title FROM thread WHERE id = ?').get(saved.id)
					?.title,
				saved.title,
			);
		} finally {
			backup.close();
		}
		store.close();
		const upgraded = f.driver.open(f.filename);
		try {
			t.is(schemaVersion(upgraded), 3);
			t.deepEqual(
				upgraded
					.prepare('SELECT version FROM schema_migration ORDER BY version')
					.all()
					.map(row => row.version),
				[1, 2, 3],
			);
		} finally {
			upgraded.close();
		}
		(await f.open()).close();
		t.is(
			readdirSync(f.root).filter(name => name.includes('.backup-')).length,
			1,
		);
	});

test('a failed manual-title migration rolls back its column and version (CHAT-12, DATA-03)', t => {
	const f = fixture(t);
	const {saved} = legacyMetadata(f, 2);
	const database = f.driver.open(f.filename);
	t.teardown(() => database.close());
	const injected: SqlDatabase = {
		...database,
		exec: sql => {
			if (sql === 'PRAGMA user_version = 3')
				throw new IpcFailure('INTERNAL', 'fixture migration failure');
			database.exec(sql);
		},
	};
	t.throws(() => migrate(injected), {code: 'INTERNAL'});
	t.is(schemaVersion(database), 2);
	t.false(
		database
			.prepare('PRAGMA table_info(thread)')
			.all()
			.some(column => column.name === 'title_manually_set'),
	);
	t.is(
		database.prepare('SELECT title FROM thread WHERE id = ?').get(saved.id)
			?.title,
		saved.title,
	);
});

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
		[1, 2, 3],
	);
	t.false(readdirSync(f.root).some(name => name.includes('.backup-')));
	if (process.platform !== 'win32')
		t.is(statSync(f.filename).mode & 0o777, 0o600);
});

test('title updates persist only scoped current metadata and a sticky boolean (CHAT-12)', async t => {
	const f = fixture(t);
	const store = await f.open();
	const owner = project(f.root);
	const saved = thread(owner);
	store.projects.save(owner);
	store.threads.save(saved);
	const target = {projectId: owner.id, threadId: saved.id};
	t.false(store.threads.getTitleManuallySet(owner.id, saved.id));
	t.deepEqual(
		store.threads.setTitle({
			...target,
			title: 'fixture generated',
			manuallySet: false,
		}),
		{...saved, title: 'fixture generated'},
	);
	t.false(store.threads.getTitleManuallySet(owner.id, saved.id));
	const renamed = store.threads.setTitle({
		...target,
		title: '  fixture manual  ',
		manuallySet: true,
	});
	t.deepEqual(renamed, {...saved, title: 'fixture manual'});
	t.true(store.threads.getTitleManuallySet(owner.id, saved.id));
	t.deepEqual(
		store.threads.setTitle({
			...target,
			title: 'late generated',
			manuallySet: false,
		}),
		renamed,
	);
	store.threads.save({...renamed, runState: 'running'});
	store.close();
	const reopened = await f.open();
	t.true(reopened.threads.getTitleManuallySet(owner.id, saved.id));
	t.deepEqual(reopened.threads.get(owner.id, saved.id), {
		...renamed,
		runState: 'interrupted',
	});
});

test('title metadata refuses cross-project targets and non-allowlisted fields (CHAT-12, DATA-04)', async t => {
	const f = fixture(t);
	const store = await f.open();
	const owner = project(f.root);
	const saved = thread(owner);
	store.projects.save(owner);
	store.threads.save(saved);
	const input = {
		projectId: owner.id,
		threadId: saved.id,
		title: 'fixture manual',
		manuallySet: true,
	};
	t.is(store.threads.getTitleManuallySet(randomUUID(), saved.id), undefined);
	t.throws(() => store.threads.setTitle({...input, projectId: randomUUID()}), {
		code: 'NOT_FOUND',
	});
	t.throws(() => store.threads.setTitle({...input, threadId: randomUUID()}), {
		code: 'NOT_FOUND',
	});
	for (const changed of [
		{title: ''},
		{title: '   '},
		{title: 't'.repeat(501)},
		{manuallySet: 'true'},
		{threadId: 'not-an-id'},
		{projectId: 'not-an-id'},
		{prompt: 'fixture content must not persist'},
		{history: []},
	]) {
		t.throws(
			() => store.threads.setTitle({...input, ...changed} as typeof input),
			{code: 'VALIDATION'},
		);
	}
	t.throws(() => store.threads.getTitleManuallySet('not-an-id', saved.id), {
		code: 'VALIDATION',
	});
	t.deepEqual(store.threads.get(owner.id, saved.id), saved);
	t.false(store.threads.getTitleManuallySet(owner.id, saved.id));
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
	t.throws(() => migrate(injected), {code: 'INTERNAL'});
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

test('sidecars left after a connection closes are moved with the database', async t => {
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
				prepare: sql => ({
					get: () =>
						sql === 'PRAGMA user_version' ? {user_version: 0} : undefined,
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
	t.is(reopened.threads.get(one.id, first.id)?.runState, 'interrupted');
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

test('repositories refuse a saved ACP session identity already owned by another project', async t => {
	const f = fixture(t);
	const store = await f.open();
	const first = project(f.root);
	const secondRoot = path.join(f.root, 'another-project');
	mkdirSync(secondRoot);
	const second = project(secondRoot);
	store.projects.save(first);
	store.projects.save(second);
	const original = thread(first);
	store.threads.save(original);
	const duplicate = thread(second, {
		nanocoderSessionId: original.nanocoderSessionId,
	});
	t.throws(() => store.threads.save(duplicate), {code: 'INTERNAL'});
	t.deepEqual(store.threads.get(first.id, original.id), original);
	t.deepEqual(store.threads.list(second.id, 'active'), []);
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
	t.throws(() => store.projects.save({...row, trusted: true}), {
		code: 'DENIED',
	});
});

test('concurrent opens recheck the migration version under the write lock', async t => {
	const f = fixture(t);
	const previous = f.driver.open(f.filename);
	previous.exec(migrations[0].sql);
	previous
		.prepare('INSERT INTO schema_migration VALUES (?, ?)')
		.run(1, '2026-10-29T12:00:00.000Z');
	previous.prepare('INSERT INTO setting VALUES (?, ?)').run('theme', '"light"');
	previous.exec('PRAGMA user_version = 1');
	previous.close();
	let arrived = 0;
	let release!: () => void;
	const barrier = new Promise<void>(resolve => {
		release = resolve;
	});
	const backups: string[] = [];
	const driver: SqlDriver = {
		open: f.driver.open,
		backup: async (db, filename) => {
			await f.driver.backup(db, filename);
			backups.push(filename);
			if (++arrived === 2) release();
			await barrier;
		},
	};
	const stores = await Promise.all([
		desktopStoreFactory.open({databasePath: f.filename, driver}),
		desktopStoreFactory.open({databasePath: f.filename, driver}),
	]);
	for (const store of stores) {
		t.teardown(() => store.close());
		t.is(store.getSettings().theme, 'light');
	}
	t.is(backups.length, 2);
	for (const filename of backups) {
		const db = f.driver.open(filename);
		t.is(schemaVersion(db), 1);
		db.close();
	}
	stores[0].updateSettings({editor: 'zed'});
	stores[1].updateSettings({defaultMode: 'plan'});
	t.like(stores[0].getSettings(), {
		editor: 'zed',
		defaultMode: 'plan',
		theme: 'light',
	});
	stores[0].updateUiState({inspector: 'review'});
	stores[1].updateUiState({bottomPanel: 'terminal'});
	t.like(stores[0].getUiState(), {
		inspector: 'review',
		bottomPanel: 'terminal',
	});
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	t.is(schemaVersion(db), 3);
	t.deepEqual(
		db
			.prepare('SELECT version FROM schema_migration ORDER BY version')
			.all()
			.map(row => row.version),
		[1, 2, 3],
	);
});

test('settings and UI patches hold the write lock before reading the previous state', async t => {
	const f = fixture(t);
	(await f.open()).close();
	const rival = f.driver.open(f.filename);
	t.teardown(() => rival.close());
	let armed = false;
	let locked = false;
	let reads = 0;
	const driver: SqlDriver = {
		...f.driver,
		open: filename => {
			const db = f.driver.open(filename);
			return {
				...db,
				exec: sql => {
					db.exec(sql);
					if (sql === 'BEGIN IMMEDIATE') locked = true;
					if (sql === 'COMMIT' || sql === 'ROLLBACK') locked = false;
				},
				prepare: sql => {
					if (
						armed &&
						(sql === 'SELECT key, value FROM setting' ||
							sql === 'SELECT value FROM ui_state WHERE id = 1')
					) {
						reads++;
						t.true(locked);
						t.throws(() => rival.exec('BEGIN IMMEDIATE'), {code: 'INTERNAL'});
					}
					return db.prepare(sql);
				},
			};
		},
	};
	const store = await desktopStoreFactory.open({
		databasePath: f.filename,
		driver,
	});
	t.teardown(() => store.close());
	armed = true;
	store.updateSettings({theme: 'light'});
	store.updateUiState({inspector: 'review'});
	armed = false;
	t.is(reads, 2);
	t.false(locked);
	rival.exec('BEGIN IMMEDIATE');
	rival.exec('ROLLBACK');
	t.is(store.getSettings().theme, 'light');
	t.is(store.getUiState().inspector, 'review');
});

for (const version of [migrations.length, migrations.length + 1]) {
	test(`a failed integrity check cannot replace a newer ledger with user_version ${version}`, async t => {
		const f = fixture(t);
		(await f.open()).close();
		const db = f.driver.open(f.filename);
		db.exec(`
			CREATE TABLE future_table(n INTEGER CHECK(n >= 0)) STRICT;
			PRAGMA ignore_check_constraints = ON;
			INSERT INTO future_table VALUES (-1);
			PRAGMA ignore_check_constraints = OFF;
		`);
		db.prepare('INSERT INTO schema_migration VALUES (?, ?)').run(
			migrations.length + 1,
			'2026-10-29T12:00:00.000Z',
		);
		db.exec(`PRAGMA user_version = ${version}`);
		t.true(
			db
				.prepare('PRAGMA integrity_check')
				.all()
				.some(row => row.integrity_check !== 'ok'),
		);
		db.close();
		const before = readFileSync(f.filename);
		await t.throwsAsync(f.open, {code: 'STORE_TOO_NEW'});
		t.deepEqual(readFileSync(f.filename), before);
		t.deepEqual(readdirSync(f.root), ['desktop.sqlite']);
	});
}

test('metadata can be updated when its unchanged saved directory is missing', async t => {
	const f = fixture(t);
	const store = await f.open();
	const root = path.join(f.root, 'project');
	mkdirSync(root);
	const owner = project(root);
	const saved = thread(owner);
	store.projects.save(owner);
	store.threads.save(saved);
	renameSync(root, `${root}-moved`);
	store.threads.save({...saved, archiveState: 'archived'});
	const archived = store.threads.get(owner.id, saved.id);
	t.is(archived?.archiveState, 'archived');
	store.threads.save({...saved, archiveState: 'archived', runState: 'failed'});
	t.is(store.threads.get(owner.id, saved.id)?.runState, 'failed');
	t.is(store.threads.get(owner.id, saved.id)?.archiveState, 'archived');
	store.projects.save({...owner, displayName: 'missing project'});
	t.is(store.projects.get(owner.id)?.displayName, 'missing project');
	t.throws(() => store.threads.save({...saved, id: randomUUID()}), {
		code: 'DENIED',
	});
	t.throws(
		() => store.threads.save({...saved, sessionCwd: `${root}-missing`}),
		{code: 'DENIED'},
	);
	t.throws(() => store.projects.save({...owner, trusted: true}), {
		code: 'DENIED',
	});
});

test('mixed ISO precision is normalised and recent lists use chronological order', async t => {
	const f = fixture(t);
	const store = await f.open();
	const other = path.join(f.root, 'other');
	mkdirSync(other);
	const earlier = '2026-10-29T12:00:00Z';
	const later = '2026-10-29T12:00:00.100Z';
	const one = project(f.root, {lastOpenedAt: earlier, createdAt: earlier});
	const two = project(other, {lastOpenedAt: later});
	store.projects.save(one);
	store.projects.save(two);
	const first = thread(one, {lastActivityAt: earlier});
	const last = thread(one, {lastActivityAt: later});
	store.threads.save(first);
	store.threads.save(last);
	t.deepEqual(
		store.projects.list().map(row => row.id),
		[two.id, one.id],
	);
	t.deepEqual(
		store.threads.list(one.id, 'active').map(row => row.id),
		[last.id, first.id],
	);
	t.is(store.projects.get(one.id)?.createdAt, '2026-10-29T12:00:00.000Z');
	const db = f.driver.open(f.filename);
	t.teardown(() => db.close());
	t.is(
		db.prepare('SELECT last_opened_at FROM project WHERE id = ?').get(one.id)
			?.last_opened_at,
		'2026-10-29T12:00:00.000Z',
	);
	t.is(
		db.prepare('SELECT last_activity_at FROM thread WHERE id = ?').get(first.id)
			?.last_activity_at,
		'2026-10-29T12:00:00.000Z',
	);
	db.prepare('UPDATE project SET last_opened_at = ? WHERE id = ?').run(
		earlier,
		one.id,
	);
	db.prepare('UPDATE thread SET last_activity_at = ? WHERE id = ?').run(
		earlier,
		first.id,
	);
	t.deepEqual(
		store.projects.list().map(row => row.id),
		[two.id, one.id],
	);
	t.deepEqual(
		store.threads.list(one.id, 'active').map(row => row.id),
		[last.id, first.id],
	);
});

test('a stale runtime override does not block unrelated settings and can be cleared', async t => {
	const f = fixture(t);
	const store = await f.open();
	const cli = path.join(f.root, 'fixture-cli.js');
	writeFileSync(cli, '');
	store.updateSettings({nanocoderOverridePath: cli});
	renameSync(cli, `${cli}-moved`);
	t.is(store.updateSettings({theme: 'light'}).theme, 'light');
	t.is(
		store.updateSettings({nanocoderOverridePath: cli}).nanocoderOverridePath,
		cli,
	);
	t.throws(
		() => store.updateSettings({nanocoderOverridePath: `${cli}-missing`}),
		{code: 'VALIDATION'},
	);
	t.is(
		store.updateSettings({nanocoderOverridePath: null}).nanocoderOverridePath,
		null,
	);
});

test('native WAL recovery preserves committed data after SQLite closes and checkpoints', async t => {
	const f = fixture(t);
	(await f.open()).close();
	const script = `
		const {DatabaseSync} = require('node:sqlite');
		const db = new DatabaseSync(process.argv[1]);
		db.exec('PRAGMA journal_mode = WAL; UPDATE schema_migration SET version = 0 WHERE version = 1');
		process.kill(process.pid, 'SIGKILL');
	`;
	const crashed = spawnSync(process.execPath, ['-e', script, f.filename], {
		stdio: 'ignore',
	});
	t.is(crashed.error, undefined);
	t.not(crashed.status, 0);
	t.true(readdirSync(f.root).includes('desktop.sqlite-wal'));
	t.true(readdirSync(f.root).includes('desktop.sqlite-shm'));
	(await f.open()).close();
	const directory = readdirSync(f.root).find(name =>
		name.includes('.corrupt-'),
	) as string;
	t.deepEqual(readdirSync(path.join(f.root, directory)), ['desktop.sqlite']);
	const preserved = f.driver.open(
		path.join(f.root, directory, 'desktop.sqlite'),
	);
	t.teardown(() => preserved.close());
	t.is(
		preserved.prepare('SELECT min(version) AS n FROM schema_migration').get()
			?.n,
		0,
	);
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
