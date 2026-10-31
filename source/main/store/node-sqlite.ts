import {backup, DatabaseSync} from 'node:sqlite';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {SqlDatabase, SqlDriver} from '@/main/store/contracts';

function checked<T>(action: () => T): T {
	try {
		return action();
	} catch (error) {
		const code = Number((error as {errcode?: number}).errcode) & 0xff;
		throw new IpcFailure(
			code === 11 || code === 26 ? 'STORE_CORRUPT' : 'INTERNAL',
			'The desktop database could not complete the operation',
		);
	}
}

export function createNodeSqliteDriver(): SqlDriver {
	const connections = new WeakMap<SqlDatabase, DatabaseSync>();
	return {
		open: filename => {
			const native = checked(() => new DatabaseSync(filename));
			const database: SqlDatabase = {
				exec: sql => checked(() => native.exec(sql)),
				prepare: sql => {
					const statement = checked(() => native.prepare(sql));
					return {
						run: (...values) => checked(() => statement.run(...values)),
						get: (...values) => checked(() => statement.get(...values)),
						all: (...values) => checked(() => statement.all(...values)),
					};
				},
				close: () => checked(() => native.close()),
			};
			connections.set(database, native);
			return database;
		},
		backup: async (database, filename) => {
			const native = connections.get(database);
			if (!native) {
				throw new IpcFailure('INTERNAL', 'Unknown desktop database');
			}
			try {
				await backup(native, filename);
			} catch {
				throw new IpcFailure('INTERNAL', 'The database backup failed');
			}
		},
	};
}
