import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ExecutionContext} from 'ava';
import {migrate} from '@/main/store/migrations';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import {
	type ThreadHistoryPatch,
	type ThreadHistoryScope,
	threadHistoryRepository,
} from '@/main/store/thread-execution-identities';

export function threadHistoryFixture(t: ExecutionContext) {
	const root = mkdtempSync(path.join(tmpdir(), 'nd-execution-identities-'));
	const filename = path.join(root, 'metadata.sqlite');
	const driver = createNodeSqliteDriver();
	let database = driver.open(filename);
	database.exec('PRAGMA foreign_keys = ON');
	migrate(database);
	t.teardown(() => {
		database.close();
		rmSync(root, {recursive: true, force: true});
	});
	const scope: ThreadHistoryScope = {
		projectId: randomUUID(),
		threadId: randomUUID(),
		sessionId: 'fixture-session',
	};
	database
		.prepare(
			`INSERT INTO project (id,canonical_root,session_cwd,display_name,trusted,default_mode,last_opened_at,created_at)
		VALUES (?,?,?,'fixture',1,'normal','2026-10-30','2026-10-30')`,
		)
		.run(scope.projectId, root, root);
	database
		.prepare(
			`INSERT INTO thread (id,project_id,nanocoder_session_id,title,archive_state,run_state,last_activity_at,session_cwd,mode)
		VALUES (?,?,?,'fixture','active','ready','2026-10-30',?,'normal')`,
		)
		.run(scope.threadId, scope.projectId, scope.sessionId, root);
	const turnId = randomUUID();
	const executionId = randomUUID();
	const patch: ThreadHistoryPatch = {
		expectedRevision: null,
		generation: 1,
		sequence: 1,
		complete: true,
		source: 'live',
		turns: [{id: turnId, ordinal: 0, outcome: 'failed'}],
		executions: [
			{
				id: executionId,
				turnId,
				toolCallId: 'opaque/tool-call-1',
				ordinal: 0,
				outcome: 'failed',
			},
		],
		agentRuns: [
			{
				id: executionId,
				threadId: scope.threadId,
				parentRunId: null,
				nanocoderChildId: null,
				role: 'explore',
				status: 'failed',
			},
		],
	};
	return {
		root,
		filename,
		scope,
		patch,
		get database() {
			return database;
		},
		get repository() {
			return threadHistoryRepository(database);
		},
		anotherThread() {
			const next = {
				...scope,
				threadId: randomUUID(),
				sessionId: 'second-session',
			};
			database
				.prepare(
					`INSERT INTO thread (id,project_id,nanocoder_session_id,title,archive_state,run_state,last_activity_at,session_cwd,mode)
				SELECT ?,project_id,?,'second fixture','active','ready',last_activity_at,session_cwd,'normal' FROM thread WHERE id=?`,
				)
				.run(next.threadId, next.sessionId, scope.threadId);
			return next;
		},
		reopen() {
			database.close();
			database = driver.open(filename);
			database.exec('PRAGMA foreign_keys = ON');
			return threadHistoryRepository(database);
		},
	};
}
