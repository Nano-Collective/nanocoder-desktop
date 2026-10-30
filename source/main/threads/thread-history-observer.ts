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
	let generation = -1;
	let sequence = -1;
	const owns = (context: SubagentTurnEndContext) =>
		!disposed &&
		!removed &&
		context.projectId === scope.projectId &&
		context.threadId === scope.threadId &&
		context.sessionId === scope.sessionId &&
		(context.generation > generation ||
			(context.generation === generation && context.sequence > sequence));
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
			current.observer.forgetThread(threadId);
		},
		dispose() {
			disposed = true;
			current.observer.dispose();
			current.clear();
		},
		commitReplay(
			patch: Omit<ThreadHistoryPatch, 'source' | 'agentRuns'>,
			observations: ReplayObservation[],
		): number {
			if (disposed || removed) refuse();
			if (!Array.isArray(observations) || observations.length > 10000)
				throw new IpcFailure('VALIDATION', 'The replay history is too large');
			const candidate = validate(threadHistoryPatchSchema, {
				...patch,
				source: 'replay',
				agentRuns: [],
			});
			const executions = new Map(
				candidate.executions.map(execution => [execution.id, execution]),
			);
			const stage = stageRuns(options.runs, scope);
			const observer = createSubagentRunObserver(stage.repository);
			try {
				let epoch: string | undefined;
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
						context.source !== 'replay' ||
						!context.replayCommitted ||
						!context.replayEpoch ||
						context.terminalEvidence === 'live' ||
						context.generation !== candidate.generation ||
						context.sequence > candidate.sequence ||
						context.sequence <= lastSequence ||
						execution.turnId !== context.turnId ||
						execution.toolCallId !== context.toolCallId ||
						tool.id !== context.toolCallId ||
						(tool.delegation && tool.delegation.history !== true) ||
						(epoch && epoch !== context.replayEpoch)
					)
						refuse();
					epoch = context.replayEpoch;
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
				const revision = options.history.apply(scope, {
					...candidate,
					source: 'replay',
					agentRuns: stage.snapshot(),
				});
				stage.activate();
				generation = candidate.generation;
				sequence = candidate.sequence;
				const previous = current;
				current = {observer, clear: stage.clear};
				previous.observer.dispose();
				previous.clear();
				return revision;
			} catch (error) {
				observer.dispose();
				stage.clear();
				throw error;
			}
		},
	};
}
