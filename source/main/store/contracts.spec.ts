import test from 'ava';
import type {DesktopStoreFactory, SqlDatabase} from '@/main/store/contracts';

test('the store driver seam accepts a library-independent adapter', async t => {
	const calls: string[] = [];
	const database: SqlDatabase = {
		exec: sql => {
			calls.push(sql);
		},
		prepare: () => ({
			run: () => ({changes: 1}),
			get: () => ({value: 1}),
			all: () => [{value: 1}],
		}),
		close: () => {
			calls.push('close');
		},
	};
	const driver: Parameters<DesktopStoreFactory['open']>[0]['driver'] = {
		open: filename => {
			calls.push(filename);
			return database;
		},
		backup: async (_database, filename) => {
			calls.push(filename);
		},
	};
	const opened = driver.open('/desktop.sqlite');
	opened.exec('BEGIN');
	const statement = opened.prepare('SELECT 1 AS value');
	t.deepEqual(statement.get(), {value: 1});
	t.deepEqual(statement.all(), [{value: 1}]);
	t.deepEqual(statement.run(), {changes: 1});
	await driver.backup(opened, '/desktop.backup.sqlite');
	opened.close();
	t.deepEqual(calls, [
		'/desktop.sqlite',
		'BEGIN',
		'/desktop.backup.sqlite',
		'close',
	]);
});
