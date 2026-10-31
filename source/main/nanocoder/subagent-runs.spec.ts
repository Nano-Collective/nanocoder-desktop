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

function staging(source: Map<string, AgentRunMetadata>) {
	const rows = new Map(
		[...source].map(([id, row]) => [id, structuredClone(row)]),
	);
	let reads = 0;
	let writes = 0;
	const repository: AgentRunRepository = {
		get: (_projectId, threadId, id) => {
			reads++;
			const row = rows.get(id);
			return row?.threadId === threadId ? structuredClone(row) : undefined;
		},
		list: (_projectId, threadId) => {
			reads++;
			return structuredClone(
				[...rows.values()].filter(row => row.threadId === threadId),
			);
		},
		save: (_projectId, row) => {
			writes++;
			rows.set(row.id, structuredClone(row));
		},
	};
	return {repository, rows, counts: () => ({reads, writes})};
}

test('SUB-05 forking is passive and a staged update changes neither original rows nor its seen watermark', t => {
	const f = fixture();
	t.true(f.observer.observe(f.context, f.tool));
	const before = structuredClone([...f.rows]);
	const stage = staging(f.rows);
	const fork = f.observer.fork(stage.repository);
	t.deepEqual(stage.counts(), {reads: 0, writes: 0});
	t.deepEqual([...f.rows], before);
	t.false(fork.observe(f.context, f.tool));
	t.true(
		fork.observe({...f.context, sequence: 2}, {...f.tool, status: 'failed'}),
	);
	t.is(stage.rows.get(f.context.executionId)?.status, 'failed');
	t.deepEqual([...f.rows], before);
	fork.dispose();
	t.true(
		f.observer.observe(
			{...f.context, sequence: 2},
			{...f.tool, status: 'completed'},
		),
	);
	t.is(f.rows.get(f.context.executionId)?.status, 'completed');
});

for (const field of ['generations', 'ended', 'removed', 'disposed'] as const) {
	test(`SUB-05 discarding a fork leaves the original ${field} state unchanged`, t => {
		const f = fixture();
		t.true(f.observer.observe(f.context, f.tool));
		const before = structuredClone([...f.rows]);
		const stage = staging(f.rows);
		const fork = f.observer.fork(stage.repository);
		const {projectId, threadId, sessionId, turnId, generation} = f.context;
		if (field === 'generations')
			t.true(fork.observe({...f.context, generation: 3, sequence: 2}, f.tool));
		else if (field === 'ended')
			t.true(
				fork.endTurn(
					{projectId, threadId, sessionId, turnId, generation, sequence: 3},
					'cancelled',
				),
			);
		else if (field === 'removed') fork.forgetThread(threadId);
		else fork.dispose();
		t.deepEqual([...f.rows], before);
		t.true(
			f.observer.observe({...f.context, generation: 2, sequence: 2}, f.tool),
		);
		if (field === 'ended')
			t.true(
				f.observer.endTurn(
					{projectId, threadId, sessionId, turnId, generation: 2, sequence: 3},
					'failed',
				),
			);
		fork.dispose();
	});
}

for (const inherited of [
	'seen',
	'generations',
	'ended',
	'removed',
	'disposed',
] as const) {
	test(`SUB-05 a fork inherits the original ${inherited} refusal without sharing mutable memory`, t => {
		const f = fixture();
		t.true(f.observer.observe({...f.context, generation: 3}, f.tool));
		if (inherited === 'ended') {
			const {projectId, threadId, sessionId, turnId} = f.context;
			t.true(
				f.observer.endTurn(
					{projectId, threadId, sessionId, turnId, generation: 3, sequence: 2},
					'cancelled',
				),
			);
		} else if (inherited === 'removed')
			f.observer.forgetThread(f.context.threadId);
		else if (inherited === 'disposed') f.observer.dispose();
		const stage = staging(f.rows);
		const fork = f.observer.fork(stage.repository);
		t.deepEqual(stage.counts(), {reads: 0, writes: 0});
		const context =
			inherited === 'seen'
				? {...f.context, generation: 3}
				: inherited === 'generations'
					? {
							...f.context,
							sequence: 4,
							generation: 2,
							executionId: randomUUID(),
							turnId: randomUUID(),
						}
					: {...f.context, generation: 4, sequence: 4};
		t.false(fork.observe(context, f.tool));
		t.is(stage.counts().writes, 0);
		fork.dispose();
	});
}

test('SUB-05 two forks keep separate watermarks and a throwing stage cannot change the original', t => {
	const f = fixture();
	t.true(f.observer.observe(f.context, f.tool));
	const one = staging(f.rows);
	const two = staging(f.rows);
	const first = f.observer.fork(one.repository);
	const second = f.observer.fork(two.repository);
	t.true(
		first.observe(
			{...f.context, sequence: 2, generation: 3},
			{...f.tool, status: 'failed'},
		),
	);
	t.true(
		second.observe(
			{...f.context, sequence: 2, generation: 2},
			{...f.tool, status: 'completed'},
		),
	);
	t.is(one.rows.get(f.context.executionId)?.status, 'failed');
	t.is(two.rows.get(f.context.executionId)?.status, 'completed');
	t.is(f.rows.get(f.context.executionId)?.status, 'running');
	const bad = f.observer.fork({
		...two.repository,
		save: () => {
			throw new Error('synthetic stage failure');
		},
	});
	t.throws(() => bad.observe({...f.context, sequence: 3}, f.tool), {
		message: 'synthetic stage failure',
	});
	t.true(f.observer.observe({...f.context, sequence: 2}, f.tool));
	first.dispose();
	second.dispose();
	bad.dispose();
});
