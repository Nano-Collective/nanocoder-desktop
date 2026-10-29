import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {SqlDatabase, SqlValue} from '@/main/store/contracts';
import {validate} from '@/main/store/validation';

export interface AgentRunMetadata {
	id: string;
	threadId: string;
	parentRunId: null;
	nanocoderChildId: null;
	role: string;
	status:
		| 'pending'
		| 'running'
		| 'completed'
		| 'failed'
		| 'interrupted'
		| 'unknown';
}

export interface AgentRunRepository {
	get(
		projectId: string,
		threadId: string,
		id: string,
	): AgentRunMetadata | undefined;
	list(projectId: string, threadId: string): AgentRunMetadata[];
	save(projectId: string, row: AgentRunMetadata): void;
}

// Composition waits for phase 1.8's main-owned replay identity.
export function agentRunRepository(database: SqlDatabase): AgentRunRepository {
	const id = z.uuid();
	const schema = z.strictObject({
		id,
		threadId: id,
		parentRunId: z.null(),
		nanocoderChildId: z.null(),
		role: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
		status: z.enum([
			'pending',
			'running',
			'completed',
			'failed',
			'interrupted',
			'unknown',
		]),
	});
	const fromRow = (row: Record<string, SqlValue>): AgentRunMetadata =>
		validate(schema, {
			id: row.id,
			threadId: row.thread_id,
			parentRunId: row.parent_run_id,
			nanocoderChildId: row.nanocoder_child_id,
			role: row.role,
			status: row.status,
		});
	return {
		get: (projectId, threadId, executionId) => {
			for (const value of [projectId, threadId, executionId])
				validate(id, value);
			const row = database
				.prepare(`SELECT a.* FROM agent_run a JOIN thread t ON a.thread_id=t.id
				WHERE t.project_id=? AND a.thread_id=? AND a.id=?`)
				.get(projectId, threadId, executionId);
			return row && fromRow(row);
		},
		list: (projectId, threadId) => {
			validate(id, projectId);
			validate(id, threadId);
			return database
				.prepare(`SELECT a.* FROM agent_run a JOIN thread t ON a.thread_id=t.id
				WHERE t.project_id=? AND a.thread_id=? ORDER BY a.id LIMIT 200`)
				.all(projectId, threadId)
				.map(fromRow);
		},
		save: (projectId, input) => {
			validate(id, projectId);
			const row = validate(schema, input);
			const owner = database
				.prepare('SELECT project_id FROM thread WHERE id=?')
				.get(row.threadId);
			const existing = database
				.prepare('SELECT thread_id FROM agent_run WHERE id=?')
				.get(row.id);
			if (
				owner?.project_id !== projectId ||
				(existing && existing.thread_id !== row.threadId)
			)
				throw new IpcFailure(
					'DENIED',
					'The run does not belong to this thread',
				);
			database
				.prepare(`INSERT INTO agent_run (id,thread_id,parent_run_id,nanocoder_child_id,role,status)
				VALUES (?,?,NULL,NULL,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,status=excluded.status`)
				.run(row.id, row.threadId, row.role, row.status);
		},
	};
}
