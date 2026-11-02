import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {
	type AgentRunMetadata,
	agentRunRepository,
} from '@/main/store/agent-runs';
import {migrate} from '@/main/store/migrations';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';

function fixture(t: ExecutionContext) {
	const work = mkdtempSync(path.join(tmpdir(), 'nd-subagent-store-'));
	const db = createNodeSqliteDriver().open(path.join(work, 'metadata.sqlite'));
	db.exec('PRAGMA foreign_keys = ON');
	migrate(db);
	t.teardown(() => {
		db.close();
		rmSync(work, {recursive: true, force: true});
	});
	const projectId = randomUUID();
	const threadId = randomUUID();
	db.prepare(
		`INSERT INTO project (id,canonical_root,session_cwd,display_name,trusted,default_mode,last_opened_at,created_at) VALUES (?,?,?,'fixture',0,'normal','2026-10-29','2026-10-29')`,
	).run(projectId, work, work);
	db.prepare(
		`INSERT INTO thread (id,project_id,nanocoder_session_id,title,archive_state,run_state,last_activity_at,session_cwd,mode) VALUES (?,?,'s','fixture','active','ready','2026-10-29',?,'normal')`,
	).run(threadId, projectId, work);
	const row: AgentRunMetadata = {
		id: randomUUID(),
		threadId,
		parentRunId: null,
		nanocoderChildId: null,
		role: 'explore',
		status: 'running',
	};
	return {db, repository: agentRunRepository(db), projectId, threadId, row};
}

test('SUB-05 passive repository upserts only metadata and cascades with its thread', t => {
	const f = fixture(t);
	f.repository.save(f.projectId, f.row);
	t.deepEqual(f.repository.get(f.projectId, f.threadId, f.row.id), f.row);
	f.repository.save(f.projectId, {...f.row, status: 'completed'});
	t.deepEqual(f.repository.list(f.projectId, f.threadId), [
		{...f.row, status: 'completed'},
	]);
	t.deepEqual(
		Object.keys(f.db.prepare('SELECT * FROM agent_run').all()[0]).sort(),
		[
			'id',
			'thread_id',
			'parent_run_id',
			'nanocoder_child_id',
			'role',
			'status',
		].sort(),
	);
	f.db.prepare('DELETE FROM thread WHERE id=?').run(f.threadId);
	t.deepEqual(f.repository.list(f.projectId, f.threadId), []);
});

test('SUB-05 repository refuses payloads, guessed child links and invalid status or role', t => {
	const f = fixture(t);
	for (const patch of [
		{prompt: 'forbidden-fixture-sentinel'},
		{rawOutput: 'forbidden-fixture-sentinel'},
		{parentRunId: randomUUID()},
		{nanocoderChildId: 'invented-child'},
		{status: 'approved'},
		{role: 'free form task content'},
		{role: 'x'.repeat(65)},
	])
		t.throws(() =>
			f.repository.save(f.projectId, {...f.row, ...patch} as AgentRunMetadata),
		);
	t.deepEqual(f.db.prepare('SELECT * FROM agent_run').all(), []);
});

test('SUB-05 foreign project and execution reassignment refuse without modifying the original', t => {
	const f = fixture(t);
	f.repository.save(f.projectId, f.row);
	const foreign = randomUUID();
	t.throws(() => f.repository.save(foreign, f.row));
	t.is(f.repository.get(foreign, f.threadId, f.row.id), undefined);
	t.throws(() =>
		f.repository.save(f.projectId, {...f.row, threadId: randomUUID()}),
	);
	t.deepEqual(f.repository.get(f.projectId, f.threadId, f.row.id), f.row);
});
