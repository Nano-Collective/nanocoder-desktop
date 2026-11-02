import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	type AgentRunMetadata,
	agentRunMetadataSchema,
	agentRunRepository,
} from '@/main/store/agent-runs';
import type {SqlDatabase, SqlValue} from '@/main/store/contracts';
import {transaction} from '@/main/store/migrations';
import {
	boundedIdentity,
	nanocoderSessionIdSchema,
	validate,
} from '@/main/store/validation';

export interface ThreadHistoryScope {
	projectId: string;
	threadId: string;
	sessionId: string;
}

export type IdentityOutcome =
	| 'unknown'
	| 'completed'
	| 'failed'
	| 'interrupted';

export interface TurnIdentity {
	id: string;
	ordinal: number;
	outcome: IdentityOutcome;
}

export interface ExecutionIdentity {
	id: string;
	turnId: string;
	toolCallId: string;
	ordinal: number;
	outcome: IdentityOutcome;
}

export interface ThreadHistory {
	revision: number;
	generation: number;
	sequence: number;
	complete: boolean;
	turns: TurnIdentity[];
	executions: ExecutionIdentity[];
}

export interface ThreadHistoryPatch {
	expectedRevision: number | null;
	generation: number;
	sequence: number;
	complete: boolean;
	source: 'live' | 'replay';
	turns: TurnIdentity[];
	executions: ExecutionIdentity[];
	agentRuns: AgentRunMetadata[];
}

export interface ThreadHistoryRepository {
	read(scope: ThreadHistoryScope): ThreadHistory | undefined;
	apply(scope: ThreadHistoryScope, patch: ThreadHistoryPatch): number;
}

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scopeSchema = z.strictObject({
	projectId: z.uuid(),
	threadId: z.uuid(),
	sessionId: nanocoderSessionIdSchema,
});
const outcomeSchema = z.enum(['unknown', 'completed', 'failed', 'interrupted']);
const turnSchema = z.strictObject({
	id: z.uuid(),
	ordinal: counter.max(9999),
	outcome: outcomeSchema,
});
const executionSchema = z.strictObject({
	id: z.uuid(),
	turnId: z.uuid(),
	toolCallId: boundedIdentity(512),
	ordinal: counter.max(9999),
	outcome: outcomeSchema,
});
const historySchema = z.strictObject({
	revision: counter.min(1),
	generation: counter,
	sequence: counter,
	complete: z.boolean(),
	turns: z.array(turnSchema).max(10000),
	executions: z.array(executionSchema).max(10000),
});
const patchSchema = z.strictObject({
	expectedRevision: counter.max(Number.MAX_SAFE_INTEGER - 1).nullable(),
	generation: counter,
	sequence: counter,
	complete: z.boolean(),
	source: z.enum(['live', 'replay']),
	turns: historySchema.shape.turns,
	executions: historySchema.shape.executions,
	agentRuns: z.array(agentRunMetadataSchema).max(10000),
});

export {
	patchSchema as threadHistoryPatchSchema,
	scopeSchema as threadHistoryScopeSchema,
};

const sameScope = (row: Record<string, SqlValue>, scope: ThreadHistoryScope) =>
	row.thread_id === scope.threadId && row.session_id === scope.sessionId;
const changedIdentity = () => {
	throw new IpcFailure('DENIED', 'The execution identity changed');
};
const unique = (values: Array<string | number>) => {
	if (new Set(values).size !== values.length) changedIdentity();
};
const outcomeFor = (
	source: ThreadHistoryPatch['source'],
	previous: unknown,
	next: IdentityOutcome,
): IdentityOutcome => {
	const known =
		previous === undefined ? undefined : validate(outcomeSchema, previous);
	if (source === 'replay') return known ?? 'unknown';
	return known === 'failed' ||
		known === 'interrupted' ||
		(known && next === 'unknown')
		? known
		: next;
};

export function threadHistoryRepository(
	database: SqlDatabase,
): ThreadHistoryRepository {
	const runs = agentRunRepository(database);
	return {
		read: input =>
			transaction(
				database,
				() => {
					const scope = validate(scopeSchema, input);
					const row = database
						.prepare(
							`SELECT h.* FROM thread_history h JOIN thread t ON t.id=h.thread_id
				AND t.nanocoder_session_id=h.session_id
				WHERE t.project_id=? AND h.thread_id=? AND h.session_id=?`,
						)
						.get(scope.projectId, scope.threadId, scope.sessionId);
					if (!row) return undefined;
					const turns = database
						.prepare(
							'SELECT * FROM thread_turn_identity WHERE thread_id=? AND session_id=? ORDER BY ordinal LIMIT 10001',
						)
						.all(scope.threadId, scope.sessionId)
						.map(turn => ({
							id: turn.id,
							ordinal: Number(turn.ordinal),
							outcome: turn.outcome,
						}));
					const executions = database
						.prepare(
							`SELECT e.* FROM thread_execution_identity e JOIN thread_turn_identity t ON t.id=e.turn_id
				WHERE e.thread_id=? AND e.session_id=? ORDER BY t.ordinal,e.ordinal LIMIT 10001`,
						)
						.all(scope.threadId, scope.sessionId)
						.map(execution => ({
							id: execution.id,
							turnId: execution.turn_id,
							toolCallId: execution.tool_call_id,
							ordinal: Number(execution.ordinal),
							outcome: execution.outcome,
						}));
					return validate(historySchema, {
						revision: Number(row.revision),
						generation: Number(row.generation),
						sequence: Number(row.sequence),
						complete: row.complete === 1,
						turns,
						executions,
					});
				},
				'read',
			),
		apply: (input, update) =>
			transaction(database, () => {
				const scope = validate(scopeSchema, input);
				const patch = validate(patchSchema, update);
				unique(patch.turns.map(turn => turn.id));
				unique(patch.turns.map(turn => turn.ordinal));
				unique(patch.executions.map(execution => execution.id));
				unique(
					patch.executions.map(
						execution => `${execution.turnId}:${execution.ordinal}`,
					),
				);
				unique(
					patch.executions.map(
						execution => `${execution.turnId}:${execution.toolCallId}`,
					),
				);
				unique(patch.agentRuns.map(run => run.id));
				const owner = database
					.prepare(
						'SELECT project_id,nanocoder_session_id FROM thread WHERE id=?',
					)
					.get(scope.threadId);
				if (
					owner?.project_id !== scope.projectId ||
					owner.nanocoder_session_id !== scope.sessionId
				)
					throw new IpcFailure(
						'DENIED',
						'The history does not belong to this thread',
					);
				const previous = database
					.prepare('SELECT * FROM thread_history WHERE thread_id=?')
					.get(scope.threadId);
				if (
					(previous ? Number(previous.revision) : null) !==
						patch.expectedRevision ||
					(previous &&
						(previous.session_id !== scope.sessionId ||
							patch.generation < Number(previous.generation) ||
							patch.sequence <= Number(previous.sequence)))
				)
					throw new IpcFailure('DENIED', 'The thread history changed');
				database
					.prepare(
						`INSERT INTO thread_history (thread_id,session_id,revision,generation,sequence,complete)
				VALUES (?,?,1,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET
				revision=revision+1,generation=excluded.generation,sequence=excluded.sequence,complete=excluded.complete`,
					)
					.run(
						scope.threadId,
						scope.sessionId,
						patch.generation,
						patch.sequence,
						patch.complete ? 1 : 0,
					);
				for (const turn of patch.turns) {
					const existing = database
						.prepare('SELECT * FROM thread_turn_identity WHERE id=?')
						.get(turn.id);
					if (
						existing &&
						(!sameScope(existing, scope) || existing.ordinal !== turn.ordinal)
					)
						changedIdentity();
					const outcome = outcomeFor(
						patch.source,
						existing?.outcome,
						turn.outcome,
					);
					database
						.prepare(
							`INSERT INTO thread_turn_identity (id,thread_id,session_id,ordinal,outcome)
					VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome`,
						)
						.run(
							turn.id,
							scope.threadId,
							scope.sessionId,
							turn.ordinal,
							outcome,
						);
				}
				for (const execution of patch.executions) {
					const existing = database
						.prepare('SELECT * FROM thread_execution_identity WHERE id=?')
						.get(execution.id);
					if (
						existing &&
						(!sameScope(existing, scope) ||
							existing.turn_id !== execution.turnId ||
							existing.tool_call_id !== execution.toolCallId ||
							existing.ordinal !== execution.ordinal)
					)
						changedIdentity();
					const outcome = outcomeFor(
						patch.source,
						existing?.outcome,
						execution.outcome,
					);
					database
						.prepare(
							`INSERT INTO thread_execution_identity (id,thread_id,session_id,turn_id,tool_call_id,ordinal,outcome)
					VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome`,
						)
						.run(
							execution.id,
							scope.threadId,
							scope.sessionId,
							execution.turnId,
							execution.toolCallId,
							execution.ordinal,
							outcome,
						);
				}
				for (const run of patch.agentRuns) {
					const execution = database
						.prepare('SELECT * FROM thread_execution_identity WHERE id=?')
						.get(run.id);
					if (
						run.threadId !== scope.threadId ||
						!execution ||
						!sameScope(execution, scope)
					)
						changedIdentity();
					const existing = runs.get(scope.projectId, scope.threadId, run.id);
					const known = existing?.status;
					const terminal =
						known === 'completed' ||
						known === 'failed' ||
						known === 'interrupted';
					const status =
						patch.source === 'replay'
							? terminal
								? known
								: 'unknown'
							: known === 'failed' ||
									known === 'interrupted' ||
									(terminal &&
										['pending', 'running', 'unknown'].includes(run.status))
								? known
								: run.status;
					runs.save(scope.projectId, {...run, status});
				}
				for (const table of [
					'thread_turn_identity',
					'thread_execution_identity',
				]) {
					const count = database
						.prepare(
							`SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${table} WHERE thread_id=? AND session_id=? LIMIT 10001)`,
						)
						.get(scope.threadId, scope.sessionId);
					if (Number(count?.count) > 10000) changedIdentity();
				}
				return Number(
					database
						.prepare('SELECT revision FROM thread_history WHERE thread_id=?')
						.get(scope.threadId)?.revision,
				);
			}),
	};
}
