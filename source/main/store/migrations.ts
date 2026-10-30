import {IpcFailure} from '@/main/ipc/handle-request';
import type {SqlDatabase} from '@/main/store/contracts';
import {metadataSql} from '@/main/store/migrations/001-metadata';
import {uiStateSql} from '@/main/store/migrations/002-ui-state';
import {manualThreadTitlesSql} from '@/main/store/migrations/003-manual-thread-titles';

export const migrations = [
	{version: 1, sql: metadataSql},
	{version: 2, sql: uiStateSql},
	{version: 3, sql: manualThreadTitlesSql},
] as const;

export function transaction<T>(
	database: SqlDatabase,
	action: () => T,
	kind: 'read' | 'write' = 'write',
): T {
	database.exec(kind === 'read' ? 'BEGIN' : 'BEGIN IMMEDIATE');
	try {
		const result = action();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

export function schemaVersion(database: SqlDatabase): number {
	const version = Number(
		database.prepare('PRAGMA user_version').get()?.user_version,
	);
	if (version > migrations.length) {
		throw new IpcFailure(
			'STORE_TOO_NEW',
			'This database needs a newer version of Nanocoder Desktop. Update the app to open it.',
		);
	}
	const hasRecord =
		database
			.prepare(
				"SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migration'",
			)
			.get() !== undefined;
	const recorded = hasRecord
		? database
				.prepare('SELECT version FROM schema_migration ORDER BY version')
				.all()
		: [];
	if (recorded.some(row => Number(row.version) > migrations.length)) {
		throw new IpcFailure(
			'STORE_TOO_NEW',
			'Update Nanocoder Desktop to open this database',
		);
	}
	if (
		version < 0 ||
		recorded.length !== version ||
		recorded.some((row, index) => row.version !== index + 1)
	) {
		throw new IpcFailure(
			'STORE_CORRUPT',
			'The database migration record is invalid',
		);
	}
	return version;
}

export function migrate(database: SqlDatabase): void {
	for (const migration of migrations) {
		transaction(database, () => {
			if (schemaVersion(database) >= migration.version) return;
			database.exec(migration.sql);
			database
				.prepare(
					'INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)',
				)
				.run(migration.version, new Date().toISOString());
			database.exec(`PRAGMA user_version = ${migration.version}`);
		});
	}
}
