import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	createSubagentRunObserver,
	type SubagentRunContext,
	type SubagentTurnEndContext,
	subagentRunContextSchema,
} from '@/main/nanocoder/subagent-runs';
import {
	type AgentRunMetadata,
	type AgentRunRepository,
	agentRunMetadataSchema,
} from '@/main/store/agent-runs';
import {
	type ThreadHistoryPatch,
	type ThreadHistoryRepository,
	type ThreadHistoryScope,
	threadHistoryPatchSchema,
	threadHistoryScopeSchema,
} from '@/main/store/thread-execution-identities';
import {validate} from '@/main/store/validation';
import type {TurnEvent} from '@/shared/ipc';

export interface ReplayObservation {
	context: SubagentRunContext;
	tool: Extract<TurnEvent, {type: 'tool'}>;
}

interface TurnCompletion {
	context: SubagentTurnEndContext;
	outcome: 'completed' | 'failed' | 'cancelled';
}

const completionSchema = z.strictObject({
	context: subagentRunContextSchema.pick({
		projectId: true,
		threadId: true,
		sessionId: true,
		turnId: true,
		sequence: true,
		generation: true,
	}),
	outcome: z.enum(['completed', 'failed', 'cancelled']),
});

function stageRuns(base: AgentRunRepository, scope: ThreadHistoryScope) {
	const rows = new Map<string, AgentRunMetadata>();
	let active = false;
	const owns = (projectId: string, threadId: string) =>
		projectId === scope.projectId && threadId === scope.threadId;
	const repository: AgentRunRepository = {
		get: (projectId, threadId, executionId) => {
			if (!owns(projectId, threadId)) return undefined;
			const row =
				rows.get(executionId) ?? base.get(projectId, threadId, executionId);
			return row && structuredClone(row);
		},
		list: (projectId, threadId) => {
			if (!owns(projectId, threadId)) return [];
			return [
				...new Map(
					[...base.list(projectId, threadId), ...rows.values()].map(row => [
						row.id,
						structuredClone(row),
					]),
				).values(),
			];
		},
		save: (projectId, input) => {
			const row = validate(agentRunMetadataSchema, input);
			if (!owns(projectId, row.threadId))
				throw new IpcFailure(
					'DENIED',
					'The run does not belong to this thread',
				);
			if (active) base.save(projectId, row);
			else rows.set(row.id, structuredClone(row));
		},
	};
	return {
		repository,
		snapshot: () => structuredClone([...rows.values()]),
		activate: () => {
			active = true;
			rows.clear();
		},
		clear: () => rows.clear(),
	};
}

export function createThreadHistoryObserver(options: {
	scope: ThreadHistoryScope;
	history: ThreadHistoryRepository;
	runs: AgentRunRepository;
}) {
	const scope = validate(
		threadHistoryScopeSchema,
		structuredClone(options.scope),
	);
	let disposed = false;
	let removed = false;
	let committing = false;
	let epoch = 0;
	let generation = -1;
	let sequence = -1;
	const owns = (context: SubagentTurnEndContext) =>
		!disposed &&
		!removed &&
		!committing &&
		context.projectId === scope.projectId &&
		context.threadId === scope.threadId &&
		context.sessionId === scope.sessionId &&
		context.generation >= generation &&
		context.sequence > sequence;
	const refuse: () => never = () => {
		throw new IpcFailure('DENIED', 'The replay observation changed');
	};
	let current: {
		observer: ReturnType<typeof createSubagentRunObserver>;
		clear(): void;
	} = {
		observer: createSubagentRunObserver(options.runs),
		clear: () => undefined,
	};
	const commit = (
		source: 'live' | 'replay',
		patch: Omit<ThreadHistoryPatch, 'source' | 'agentRuns'>,
		observations: ReplayObservation[],
		terminal?: TurnCompletion,
	): number => {
		if (disposed || removed || committing) refuse();
		if (!Array.isArray(observations) || observations.length > 10000)
			throw new IpcFailure('VALIDATION', 'The replay history is too large');
		const candidate = validate(threadHistoryPatchSchema, {
			...patch,
			source,
			agentRuns: [],
		});
		if (candidate.generation < generation || candidate.sequence <= sequence)
			refuse();
		const ownerEpoch = epoch;
		committing = true;
		const stage = stageRuns(options.runs, scope);
		const observer =
			source === 'live'
				? current.observer.fork(stage.repository)
				: createSubagentRunObserver(stage.repository);
		const assertOwner = () => {
			if (disposed || removed || epoch !== ownerEpoch) refuse();
		};
		try {
			const executions = new Map(
				candidate.executions.map(execution => [execution.id, execution]),
			);
			let replayEpoch: string | undefined;
			let lastSequence = -1;
			for (const {context: input, tool} of observations) {
				const parsed = subagentRunContextSchema.safeParse(input);
				if (!parsed.success) refuse();
				const context = parsed.data;
				const execution = executions.get(context.executionId);
				if (
					!execution ||
					context.projectId !== scope.projectId ||
					context.threadId !== scope.threadId ||
					context.sessionId !== scope.sessionId ||
					context.source !== source ||
					context.generation !== candidate.generation ||
					context.sequence > candidate.sequence ||
					context.sequence <= lastSequence ||
					context.sequence <= sequence ||
					execution.turnId !== context.turnId ||
					execution.toolCallId !== context.toolCallId ||
					tool.id !== context.toolCallId ||
					(tool.delegation && tool.delegation.history !== (source === 'replay'))
				)
					refuse();
				if (source === 'replay') {
					if (
						!context.replayCommitted ||
						!context.replayEpoch ||
						context.terminalEvidence === 'live' ||
						(replayEpoch && replayEpoch !== context.replayEpoch)
					)
						refuse();
					replayEpoch = context.replayEpoch;
				} else if (
					context.terminalEvidence !== 'live' ||
					context.replayEpoch !== undefined ||
					context.replayCommitted !== undefined
				) {
					refuse();
				}
				lastSequence = context.sequence;
				if (
					(tool.delegation ||
						stage.repository.get(
							scope.projectId,
							scope.threadId,
							context.executionId,
						)) &&
					!observer.observe(context, tool)
				)
					refuse();
			}
			if (terminal) {
				const end = validate(completionSchema, terminal);
				if (
					source !== 'live' ||
					end.context.projectId !== scope.projectId ||
					end.context.threadId !== scope.threadId ||
					end.context.sessionId !== scope.sessionId ||
					end.context.generation !== candidate.generation ||
					end.context.sequence > candidate.sequence ||
					end.context.sequence <= lastSequence ||
					end.context.sequence <= sequence ||
					!candidate.turns.some(turn => turn.id === end.context.turnId) ||
					!observer.endTurn(end.context, end.outcome)
				)
					refuse();
			}
			assertOwner();
			const revision = options.history.apply(scope, {
				...candidate,
				agentRuns: stage.snapshot(),
			});
			assertOwner();
			stage.activate();
			generation = candidate.generation;
			sequence = candidate.sequence;
			epoch++;
			const previous = current;
			current = {observer, clear: stage.clear};
			previous.observer.dispose();
			previous.clear();
			return revision;
		} catch (error) {
			observer.dispose();
			stage.clear();
			throw error;
		} finally {
			committing = false;
		}
	};
	return {
		observe(context: SubagentRunContext, tool: ReplayObservation['tool']) {
			if (context.source !== 'live' || !owns(context)) return false;
			return current.observer.observe(context, tool);
		},
		endTurn(...args: Parameters<typeof current.observer.endTurn>) {
			if (!owns(args[0])) return false;
			return current.observer.endTurn(...args);
		},
		forgetThread(threadId: string) {
			if (threadId !== scope.threadId) return;
			removed = true;
			epoch++;
			current.observer.forgetThread(threadId);
		},
		dispose() {
			disposed = true;
			epoch++;
			current.observer.dispose();
			current.clear();
		},
		commitReplay(
			patch: Omit<ThreadHistoryPatch, 'source' | 'agentRuns'>,
			observations: ReplayObservation[],
		): number {
			return commit('replay', patch, observations);
		},
		commitLive(
			patch: Omit<ThreadHistoryPatch, 'source' | 'agentRuns'>,
			observations: ReplayObservation[],
			terminal?: TurnCompletion,
		): number {
			return commit('live', patch, observations, terminal);
		},
	};
}
