import {randomUUID} from 'node:crypto';
import test from 'ava';
import {
	createSubagentRunObserver,
	type SubagentRunContext,
} from '@/main/nanocoder/subagent-runs';
import type {
	AgentRunMetadata,
	AgentRunRepository,
} from '@/main/store/agent-runs';

function fixture() {
	const rows = new Map<string, AgentRunMetadata>();
	const repository: AgentRunRepository = {
		get: (_p, threadId, id) =>
			rows.get(id)?.threadId === threadId ? rows.get(id) : undefined,
		list: (_p, threadId) =>
			[...rows.values()].filter(row => row.threadId === threadId),
		save: (_p, row) => {
			rows.set(row.id, row);
		},
	};
	const context: SubagentRunContext = {
		projectId: randomUUID(),
		threadId: randomUUID(),
		sessionId: 'session-fixture',
		turnId: randomUUID(),
		executionId: randomUUID(),
		toolCallId: 'tool-fixture',
		sequence: 1,
		generation: 1,
		source: 'live',
		terminalEvidence: 'live',
	};
	const tool = {
		type: 'tool' as const,
		id: context.toolCallId,
		status: 'in_progress',
		delegation: {
			role: 'explore',
			task: 'never-persist-fixture-task',
			history: false,
		},
	};
	return {rows, observer: createSubagentRunObserver(repository), context, tool};
}

for (const [outcome, expected] of [
	['cancelled', 'interrupted'],
	['failed', 'failed'],
	['completed', 'unknown'],
] as const) {
	test(`SUB-05 owner turn ${outcome} settles unfinished runs without inventing tool success`, t => {
		const f = fixture();
		t.true(f.observer.observe(f.context, f.tool));
		const {projectId, threadId, sessionId, turnId, generation} = f.context;
		const end = {
			projectId,
			threadId,
			sessionId,
			turnId,
			generation,
			sequence: 3,
		};
		t.false(f.observer.endTurn({...end, generation: 0}, outcome));
		t.true(f.observer.endTurn(end, outcome));
		t.is(f.rows.get(f.context.executionId)?.status, expected);
		t.false(f.observer.observe({...f.context, sequence: 4}, f.tool));
		t.false(f.observer.endTurn(end, outcome));
	});
}

test('SUB-05 passive observer needs main identity and stores no task or tool input', t => {
	const f = fixture();
	t.true(
		f.observer.observe(f.context, {
			...f.tool,
			details: {input: 'never-persist-fixture-input'},
		}),
	);
	t.deepEqual(
		[...f.rows.values()],
		[
			{
				id: f.context.executionId,
				threadId: f.context.threadId,
				parentRunId: null,
				nanocoderChildId: null,
				role: 'explore',
				status: 'running',
			},
		],
	);
	t.false(f.observer.observe(f.context, f.tool));
	t.true(
		f.observer.observe(
			{...f.context, sequence: 2},
			{type: 'tool', id: f.tool.id, status: 'failed'},
		),
	);
	t.is(f.rows.get(f.context.executionId)?.status, 'failed');
});

test('SUB-05 synthetic or incomplete replay never overwrites known failures or fabricates success', t => {
	const f = fixture();
	t.true(f.observer.observe(f.context, {...f.tool, status: 'failed'}));
	const replay: SubagentRunContext = {
		...f.context,
		generation: 2,
		source: 'replay',
		terminalEvidence: 'replay-synthetic',
		replayEpoch: randomUUID(),
		replayCommitted: false,
	};
	t.false(
		f.observer.observe(replay, {
			...f.tool,
			status: 'completed',
			delegation: {history: true},
		}),
	);
	t.is(f.rows.get(f.context.executionId)?.status, 'failed');
	t.true(
		f.observer.observe(
			{...replay, replayCommitted: true},
			{...f.tool, status: 'completed', delegation: {history: true}},
		),
	);
	t.is(f.rows.get(f.context.executionId)?.status, 'failed');
	const imported = {
		...replay,
		replayCommitted: true,
		executionId: randomUUID(),
		turnId: randomUUID(),
	};
	t.true(
		f.observer.observe(imported, {
			...f.tool,
			status: 'completed',
			delegation: {history: true},
		}),
	);
	t.is(f.rows.get(imported.executionId)?.status, 'unknown');
});

test('SUB-05 stale generation, wrong scope, child-only packets and removed threads never write', t => {
	const f = fixture();
	t.false(f.observer.observe({...f.context, toolCallId: 'different'}, f.tool));
	t.false(
		f.observer.observe(f.context, {
			type: 'tool',
			id: f.tool.id,
			status: 'completed',
		}),
	);
	t.true(f.observer.observe({...f.context, generation: 3}, f.tool));
	t.false(
		f.observer.observe(
			{...f.context, generation: 2, sequence: 9},
			{...f.tool, status: 'failed'},
		),
	);
	t.false(
		f.observer.observe(
			{...f.context, turnId: randomUUID(), sequence: 10},
			f.tool,
		),
	);
	f.observer.forgetThread(f.context.threadId);
	t.false(f.observer.observe({...f.context, generation: 4}, f.tool));
	f.observer.dispose();
	t.false(
		f.observer.observe(
			{...f.context, threadId: randomUUID(), executionId: randomUUID()},
			f.tool,
		),
	);
});
