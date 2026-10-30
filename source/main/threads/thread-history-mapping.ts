import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	type ThreadHistory,
	type ThreadHistoryPatch,
	type ThreadHistoryScope,
	threadHistoryPatchSchema,
	threadHistoryScopeSchema,
} from '@/main/store/thread-execution-identities';
import {boundedIdentity, validate} from '@/main/store/validation';
import type {ReplayObservation} from '@/main/threads/thread-history-observer';
import {
	MAX_THREAD_BATCH_EVENTS,
	MAX_THREAD_REPLAY_EVENTS,
	THREAD_SEQUENCE_WIDTH,
} from '@/main/threads/thread-sequence';
import type {TurnEvent} from '@/shared/ipc';

interface ReplayShape {
	tools: Array<{index: number; tool: Extract<TurnEvent, {type: 'tool'}>}>;
}

function exactHistory(history: ThreadHistory, shapes: ReplayShape[]) {
	if (!history.complete || history.turns.length !== shapes.length) return false;
	const byTurn = new Map<string, ThreadHistory['executions']>();
	for (const execution of history.executions) {
		const rows = byTurn.get(execution.turnId) ?? [];
		rows.push(execution);
		byTurn.set(execution.turnId, rows);
	}
	if (
		history.executions.length !==
		shapes.reduce((total, shape) => total + shape.tools.length, 0)
	)
		return false;
	return history.turns.every((turn, index) => {
		const rows = byTurn.get(turn.id) ?? [];
		const tools = shapes[index].tools;
		return (
			turn.ordinal === index &&
			rows.length === tools.length &&
			rows.every(
				(row, ordinal) =>
					row.ordinal === ordinal && row.toolCallId === tools[ordinal].tool.id,
			)
		);
	});
}

export function mapThreadReplay(input: {
	scope: ThreadHistoryScope;
	history?: ThreadHistory;
	generation: number;
	firstSequence: number;
	epoch: string;
	events: TurnEvent[];
}) {
	const scope = validate(threadHistoryScopeSchema, input.scope);
	const epoch = validate(z.uuid(), input.epoch);
	validate(
		z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		input.firstSequence,
	);
	if (
		!Array.isArray(input.events) ||
		input.events.length > MAX_THREAD_REPLAY_EVENTS ||
		Buffer.byteLength(JSON.stringify(input.events), 'utf8') > 16 * 1024 * 1024
	)
		throw new IpcFailure('VALIDATION', 'The replay history is too large');
	const slot = (index: number) =>
		input.firstSequence +
		Math.floor(index / MAX_THREAD_BATCH_EVENTS) * THREAD_SEQUENCE_WIDTH +
		(index % MAX_THREAD_BATCH_EVENTS);
	const highWaterMark = input.events.length
		? slot(input.events.length - 1) + 1
		: input.firstSequence;
	validate(
		z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		highWaterMark,
	);
	const events = structuredClone(input.events);
	const turns: ThreadHistoryPatch['turns'] = [];
	const executions: ThreadHistoryPatch['executions'] = [];
	const observations: ReplayObservation[] = [];
	const shapes: ReplayShape[] = [];
	const toolIds = new Set<string>();
	let complete = true;
	for (const [index, event] of events.entries()) {
		if (event.type === 'user') {
			if (!event.text.trim()) complete = false;
			shapes.push({tools: []});
		} else if (event.type === 'tool') {
			validate(boundedIdentity(512), event.id);
			delete event.approvalOnly;
			event.history = {outcome: 'unknown'};
			event.status = 'unknown';
			if (event.delegation) event.delegation.history = true;
			const shape = shapes.at(-1);
			if (!shape || toolIds.has(event.id)) complete = false;
			toolIds.add(event.id);
			shape?.tools.push({index, tool: event});
		} else if (
			event.type === 'permission' ||
			event.type === 'permission-closed'
		) {
			throw new IpcFailure('DENIED', 'The replay contains live-only updates');
		} else if (
			((event.type === 'text' || event.type === 'thought') &&
				event.text.length > 0 &&
				!shapes.length) ||
			[
				'subagent',
				'session-message',
				'compaction',
				'compaction-chunk',
			].includes(event.type)
		) {
			complete = false;
		}
	}
	const keys = shapes.map(shape =>
		JSON.stringify(shape.tools.map(({tool}) => tool.id)),
	);
	if (new Set(keys).size !== keys.length) complete = false;
	if (input.history && !exactHistory(input.history, shapes)) complete = false;
	if (complete) {
		const previousExecutions = new Map(
			input.history?.executions.map(execution => [
				JSON.stringify([execution.turnId, execution.ordinal]),
				execution,
			]),
		);
		for (const [ordinal, shape] of shapes.entries()) {
			const turn = input.history?.turns[ordinal] ?? {
				id: randomUUID(),
				ordinal,
				outcome: 'unknown' as const,
			};
			turns.push({...turn});
			for (const [toolOrdinal, {index, tool}] of shape.tools.entries()) {
				const execution = previousExecutions.get(
					JSON.stringify([turn.id, toolOrdinal]),
				) ?? {
					id: randomUUID(),
					turnId: turn.id,
					toolCallId: tool.id,
					ordinal: toolOrdinal,
					outcome: 'unknown' as const,
				};
				executions.push({...execution});
				tool.history = {outcome: execution.outcome};
				tool.status =
					execution.outcome === 'interrupted' ? 'cancelled' : execution.outcome;
				observations.push({
					context: {
						...scope,
						turnId: turn.id,
						executionId: execution.id,
						toolCallId: tool.id,
						generation: input.generation,
						sequence: slot(index),
						source: 'replay',
						terminalEvidence:
							execution.outcome === 'unknown'
								? 'replay-synthetic'
								: 'previously-known',
						replayEpoch: epoch,
						replayCommitted: true,
					},
					tool,
				});
			}
		}
	}
	const patch = {
		expectedRevision: input.history?.revision ?? null,
		generation: input.generation,
		sequence: highWaterMark,
		complete,
		turns,
		executions,
	};
	validate(threadHistoryPatchSchema, {
		...patch,
		source: 'replay',
		agentRuns: [],
	});
	return {patch, observations, events};
}
