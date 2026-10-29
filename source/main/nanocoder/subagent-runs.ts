import {z} from 'zod';
import type {
	AgentRunMetadata,
	AgentRunRepository,
} from '@/main/store/agent-runs';
import type {TurnEvent} from '@/shared/ipc';
import {subagentLabel} from '@/shared/subagents';

export interface SubagentRunContext {
	projectId: string;
	threadId: string;
	sessionId: string;
	turnId: string;
	executionId: string;
	toolCallId: string;
	sequence: number;
	generation: number;
	source: 'live' | 'replay';
	terminalEvidence: 'live' | 'previously-known' | 'replay-synthetic';
	replayEpoch?: string;
	replayCommitted?: boolean;
}

export type SubagentTurnEndContext = Pick<
	SubagentRunContext,
	'projectId' | 'threadId' | 'sessionId' | 'turnId' | 'sequence' | 'generation'
>;

const contextSchema = z.strictObject({
	projectId: z.uuid(),
	threadId: z.uuid(),
	turnId: z.uuid(),
	executionId: z.uuid(),
	sessionId: z.string().refine(value => !!subagentLabel(value, 200)),
	toolCallId: z.string().refine(value => !!subagentLabel(value, 512)),
	sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	source: z.enum(['live', 'replay']),
	terminalEvidence: z.enum(['live', 'previously-known', 'replay-synthetic']),
	replayEpoch: z.uuid().optional(),
	replayCommitted: z.boolean().optional(),
});

const endSchema = contextSchema.pick({
	projectId: true,
	threadId: true,
	sessionId: true,
	turnId: true,
	sequence: true,
	generation: true,
});
const turnScope = (context: SubagentTurnEndContext) =>
	JSON.stringify([
		context.projectId,
		context.threadId,
		context.sessionId,
		context.turnId,
	]);

const terminal = (status: AgentRunMetadata['status']) =>
	['completed', 'failed', 'interrupted'].includes(status);

function statusFor(
	value: string | undefined,
	previous?: AgentRunMetadata,
): AgentRunMetadata['status'] {
	switch (value) {
		case 'pending':
			return 'pending';
		case 'in_progress':
			return 'running';
		case 'completed':
			return 'completed';
		case 'failed':
			return 'failed';
		case 'cancelled':
			return 'interrupted';
		case undefined:
			return previous?.status ?? 'pending';
		default:
			return 'unknown';
	}
}

// Passive only: the owner must finish mapping replay before marking it committed.
export function createSubagentRunObserver(repository: AgentRunRepository) {
	const seen = new Map<
		string,
		{scope: string; turn: string; generation: number; sequence: number}
	>();
	const generations = new Map<string, number>();
	const removed = new Set<string>();
	const ended = new Set<string>();
	let disposed = false;
	return {
		observe(
			input: SubagentRunContext,
			tool: Extract<TurnEvent, {type: 'tool'}>,
		): boolean {
			const parsed = contextSchema.safeParse(input);
			if (!parsed.success || disposed) return false;
			const context = parsed.data;
			const {projectId, threadId, executionId, generation, sequence} = context;
			const turn = turnScope(context);
			if (
				removed.has(threadId) ||
				(context.source === 'live' && ended.has(turn)) ||
				tool.id !== context.toolCallId ||
				generation < (generations.get(threadId) ?? -1)
			)
				return false;
			if (
				context.source === 'replay'
					? !context.replayCommitted ||
						!context.replayEpoch ||
						context.terminalEvidence === 'live'
					: context.terminalEvidence !== 'live'
			)
				return false;
			if (
				tool.delegation &&
				tool.delegation.history !== (context.source === 'replay')
			)
				return false;
			const scope = JSON.stringify([
				projectId,
				threadId,
				context.sessionId,
				context.turnId,
				context.toolCallId,
			]);
			const last = seen.get(executionId);
			if (
				last &&
				(last.scope !== scope ||
					generation < last.generation ||
					(generation === last.generation && sequence <= last.sequence))
			)
				return false;
			const previous = repository.get(projectId, threadId, executionId);
			if (!previous && !tool.delegation) return false;
			const candidate = tool.delegation?.role;
			const role =
				previous?.role ??
				(candidate && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(candidate)
					? candidate
					: 'subagent');
			let status = statusFor(tool.status, previous);
			if (context.terminalEvidence === 'replay-synthetic')
				status =
					previous && terminal(previous.status) ? previous.status : 'unknown';
			else if (
				previous &&
				terminal(previous.status) &&
				(status === 'pending' || status === 'running')
			)
				status = previous.status;
			repository.save(projectId, {
				id: executionId,
				threadId,
				parentRunId: null,
				nanocoderChildId: null,
				role,
				status,
			});
			seen.set(executionId, {scope, turn, generation, sequence});
			generations.set(threadId, generation);
			return true;
		},
		endTurn(
			input: SubagentTurnEndContext,
			outcome: 'completed' | 'failed' | 'cancelled',
		): boolean {
			const parsed = endSchema.safeParse(input);
			if (
				!parsed.success ||
				disposed ||
				!['completed', 'failed', 'cancelled'].includes(outcome)
			)
				return false;
			const context = parsed.data;
			const turn = turnScope(context);
			if (
				removed.has(context.threadId) ||
				ended.has(turn) ||
				context.generation < (generations.get(context.threadId) ?? -1)
			)
				return false;
			const relevant = [...seen].filter(([, last]) => last.turn === turn);
			if (
				relevant.some(
					([, last]) =>
						last.generation > context.generation ||
						(last.generation === context.generation &&
							last.sequence >= context.sequence),
				)
			)
				return false;
			for (const [executionId] of relevant) {
				const row = repository.get(
					context.projectId,
					context.threadId,
					executionId,
				);
				if (!row || (row.status !== 'pending' && row.status !== 'running'))
					continue;
				repository.save(context.projectId, {
					...row,
					status:
						outcome === 'cancelled'
							? 'interrupted'
							: outcome === 'failed'
								? 'failed'
								: 'unknown',
				});
			}
			ended.add(turn);
			generations.set(context.threadId, context.generation);
			return true;
		},
		forgetThread(threadId: string): void {
			removed.add(threadId);
		},
		dispose(): void {
			disposed = true;
			seen.clear();
			generations.clear();
			removed.clear();
			ended.clear();
		},
	};
}
