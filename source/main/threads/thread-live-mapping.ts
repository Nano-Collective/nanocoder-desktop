import {randomUUID} from 'node:crypto';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	type ExecutionIdentity,
	type IdentityOutcome,
	type ThreadHistory,
	type ThreadHistoryScope,
	threadHistoryPatchSchema,
	threadHistoryScopeSchema,
} from '@/main/store/thread-execution-identities';
import {validate} from '@/main/store/validation';
import type {ReplayObservation} from '@/main/threads/thread-history-observer';
import type {TurnEvent} from '@/shared/ipc';

const retainOutcome = (
	previous: IdentityOutcome,
	next: IdentityOutcome,
): IdentityOutcome =>
	previous === 'failed' || previous === 'interrupted' || next === 'unknown'
		? previous
		: next;

export function mapThreadLive(options: {
	scope: ThreadHistoryScope;
	history?: ThreadHistory;
	turnId: string;
	complete: boolean;
	firstSequence: number;
	highWaterMark: number;
	events: TurnEvent[];
	outcome?: 'completed' | 'failed' | 'cancelled';
}) {
	const scope = validate(threadHistoryScopeSchema, options.scope);
	if (options.events.length > 10000)
		throw new IpcFailure('VALIDATION', 'The live update is too large');
	const previous = options.history;
	const generation = previous?.generation ?? 0;
	const turn = structuredClone(
		previous?.turns.find(row => row.id === options.turnId) ?? {
			id: options.turnId,
			ordinal: previous?.turns.length ?? 0,
			outcome: 'unknown' as const,
		},
	);
	const executions = new Map<string, ExecutionIdentity>(
		(previous?.executions ?? [])
			.filter(row => row.turnId === turn.id)
			.map(row => [row.toolCallId, structuredClone(row)]),
	);
	const observations: ReplayObservation[] = [];
	for (const [offset, event] of options.events.entries()) {
		if (event.type !== 'tool') continue;
		if (event.history || event.delegation?.history)
			throw new IpcFailure(
				'DENIED',
				'The live update contains replay metadata',
			);
		const execution = executions.get(event.id) ?? {
			id: randomUUID(),
			turnId: turn.id,
			toolCallId: event.id,
			ordinal: executions.size,
			outcome: 'unknown' as const,
		};
		const tool = structuredClone(event);
		if (tool.approvalOnly) delete tool.status;
		execution.outcome = retainOutcome(
			execution.outcome,
			tool.status === 'completed'
				? 'completed'
				: tool.status === 'failed'
					? 'failed'
					: tool.status === 'cancelled'
						? 'interrupted'
						: 'unknown',
		);
		executions.set(event.id, execution);
		observations.push({
			context: {
				...scope,
				turnId: turn.id,
				executionId: execution.id,
				toolCallId: event.id,
				generation,
				sequence: options.firstSequence + offset,
				source: 'live',
				terminalEvidence: 'live',
			},
			tool,
		});
	}
	if (options.outcome) {
		const outcome =
			options.outcome === 'cancelled' ? 'interrupted' : options.outcome;
		turn.outcome = retainOutcome(turn.outcome, outcome);
		if (outcome !== 'completed')
			for (const execution of executions.values())
				if (execution.outcome === 'unknown') execution.outcome = outcome;
	}
	const patch = validate(threadHistoryPatchSchema, {
		expectedRevision: previous?.revision ?? null,
		generation,
		sequence: options.highWaterMark,
		complete: (previous?.complete ?? true) && options.complete,
		source: 'live',
		turns: [turn],
		executions: [...executions.values()],
		agentRuns: [],
	});
	const history: Omit<ThreadHistory, 'revision'> = {
		generation,
		sequence: patch.sequence,
		complete: patch.complete,
		turns: [...(previous?.turns ?? []).filter(row => row.id !== turn.id), turn],
		executions: [
			...(previous?.executions ?? []).filter(row => row.turnId !== turn.id),
			...executions.values(),
		],
	};
	return {
		patch,
		observations,
		history,
		terminal: options.outcome
			? {
					context: {
						...scope,
						turnId: turn.id,
						generation,
						sequence: options.highWaterMark,
					},
					outcome: options.outcome,
				}
			: undefined,
	};
}
