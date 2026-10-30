import {randomUUID} from 'node:crypto';
import test from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	type AgentRunMetadata,
	agentRunRepository,
} from '@/main/store/agent-runs';
import {threadHistoryFixture} from '@/main/store/fixtures/thread-history';
import {threadHistoryRepository} from '@/main/store/thread-execution-identities';
import {
	createThreadHistoryObserver,
	type ReplayObservation,
} from '@/main/threads/thread-history-observer';

test('SUB-05 replay commit refuses reentrant replacement before a second candidate can swap the observer', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	let reenter = true;
	let observer!: ReturnType<typeof createThreadHistoryObserver>;
	observer = createThreadHistoryObserver({
		scope: f.scope,
		runs,
		history: {
			read: f.repository.read,
			apply: (scope, patch) => {
				if (reenter) {
					reenter = false;
					t.throws(
						() =>
							observer.commitReplay({...f.patch, sequence: 2}, [
								observation(f, 1, 2),
							]),
						{code: 'DENIED'},
					);
				}
				return f.repository.apply(scope, patch);
			},
		},
	});
	t.teardown(() => observer.dispose());
	t.is(observer.commitReplay(f.patch, [observation(f)]), 1);
	t.is(f.repository.read(f.scope)?.revision, 1);
});

for (const invalidation of ['removed', 'disposed'] as const) {
	test(`SUB-05 ${invalidation} replay staging cannot commit or activate its stale candidate`, t => {
		const f = threadHistoryFixture(t);
		const runs = agentRunRepository(f.database);
		let observer!: ReturnType<typeof createThreadHistoryObserver>;
		observer = createThreadHistoryObserver({
			scope: f.scope,
			history: f.repository,
			runs: {
				...runs,
				get: (...args) => {
					if (invalidation === 'removed')
						observer.forgetThread(f.scope.threadId);
					else observer.dispose();
					return runs.get(...args);
				},
			},
		});
		t.teardown(() => observer.dispose());
		t.throws(() => observer.commitReplay(f.patch, [observation(f)]), {
			code: 'DENIED',
		});
		t.is(f.repository.read(f.scope), undefined);
		t.deepEqual(runs.list(f.scope.projectId, f.scope.threadId), []);
	});
}

test('SUB-05 staged replay does not permit a direct live update to mutate its original observer', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	let observer!: ReturnType<typeof createThreadHistoryObserver>;
	let probe = false;
	let probing = false;
	const entry = observation(f);
	const live = {
		...entry.context,
		source: 'live' as const,
		terminalEvidence: 'live' as const,
		replayEpoch: undefined,
		replayCommitted: undefined,
	};
	const tool = {
		...entry.tool,
		status: 'in_progress',
		delegation: {role: 'explore', history: false},
	};
	observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs: {
			...runs,
			get: (...args) => {
				if (probe && !probing) {
					probing = true;
					t.false(
						observer.observe(
							{...live, sequence: 2},
							{...tool, status: 'failed'},
						),
					);
					probing = false;
				}
				return runs.get(...args);
			},
		},
	});
	t.teardown(() => observer.dispose());
	t.true(observer.observe(live, tool));
	probe = true;
	observer.commitReplay({...f.patch, generation: 2, sequence: 3}, [
		observation(f, 2, 3),
	]);
	t.is(
		runs.get(f.scope.projectId, f.scope.threadId, live.executionId)?.status,
		'unknown',
	);
});

function liveObservation(
	f: ReturnType<typeof threadHistoryFixture>,
	generation = 1,
	sequence = 1,
): ReplayObservation {
	const entry = observation(f, generation, sequence);
	return {
		context: {
			...entry.context,
			source: 'live',
			terminalEvidence: 'live',
			replayEpoch: undefined,
			replayCommitted: undefined,
		},
		tool: {
			...entry.tool,
			status: 'in_progress',
			delegation: {role: 'explore', history: false},
		},
	};
}

for (const source of ['live', 'replay'] as const) {
	test(`SUB-05 a newer ${source} generation cannot recycle an older committed observation slot`, t => {
		const f = threadHistoryFixture(t);
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			history: f.repository,
			runs: agentRunRepository(f.database),
		});
		t.teardown(() => observer.dispose());
		observer.commitLive({...f.patch, sequence: 10}, [liveObservation(f)]);
		const before = f.repository.read(f.scope);
		const entry =
			source === 'live' ? liveObservation(f, 2, 5) : observation(f, 2, 5);
		t.throws(
			() =>
				source === 'live'
					? observer.commitLive(
							{...f.patch, expectedRevision: 1, generation: 2, sequence: 12},
							[entry],
						)
					: observer.commitReplay(
							{...f.patch, expectedRevision: 1, generation: 2, sequence: 12},
							[entry],
						),
			{code: 'DENIED'},
		);
		t.deepEqual(f.repository.read(f.scope), before);
	});
}

test('SUB-05 direct live forwarding cannot recycle a committed slot by increasing generation', t => {
	const f = threadHistoryFixture(t);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs: agentRunRepository(f.database),
	});
	t.teardown(() => observer.dispose());
	observer.commitLive({...f.patch, sequence: 10}, [liveObservation(f)]);
	const entry = liveObservation(f, 2, 5);
	t.false(observer.observe(entry.context, entry.tool));
});

for (const refusal of [
	'scope',
	'turn',
	'generation',
	'stale-sequence',
	'outcome',
	'unlisted',
	'context-field',
] as const) {
	test(`SUB-05 a live terminal with ${refusal} mismatch cannot commit or advance its ended fence`, t => {
		const f = threadHistoryFixture(t);
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			history: f.repository,
			runs: agentRunRepository(f.database),
		});
		t.teardown(() => observer.dispose());
		observer.commitLive({...f.patch, sequence: 10}, [liveObservation(f)]);
		const before = f.repository.read(f.scope);
		const terminal = {
			context: {
				...f.scope,
				turnId: f.patch.turns[0].id,
				generation: 1,
				sequence: 11,
			},
			outcome: 'completed' as const,
		};
		if (refusal === 'scope') terminal.context.sessionId = 'foreign-session';
		if (refusal === 'turn') terminal.context.turnId = randomUUID();
		if (refusal === 'generation') terminal.context.generation = 2;
		if (refusal === 'stale-sequence') terminal.context.sequence = 5;
		if (refusal === 'outcome') Object.assign(terminal, {outcome: 'invented'});
		if (refusal === 'unlisted') Object.assign(terminal, {unlisted: true});
		if (refusal === 'context-field')
			Object.assign(terminal.context, {unlisted: true});
		t.throws(
			() =>
				observer.commitLive(
					{...f.patch, expectedRevision: 1, sequence: 12},
					[],
					terminal,
				),
			{
				code: ['outcome', 'unlisted', 'context-field'].includes(refusal)
					? 'VALIDATION'
					: 'DENIED',
			},
		);
		t.deepEqual(f.repository.read(f.scope), before);
		const next = liveObservation(f, 1, 11);
		t.true(observer.observe(next.context, {...next.tool, status: 'failed'}));
	});
}

test('SUB-05 live commits structural identities and safe C rows together before activating its fork', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs,
	});
	t.teardown(() => observer.dispose());
	const patch = structuredClone(f.patch);
	patch.turns[0].outcome = 'unknown';
	patch.executions[0].outcome = 'unknown';
	const live = liveObservation(f);
	t.is(observer.commitLive(patch, [live]), 1);
	t.is(f.repository.read(f.scope)?.executions[0].id, patch.executions[0].id);
	t.is(
		runs.get(f.scope.projectId, f.scope.threadId, patch.executions[0].id)
			?.status,
		'running',
	);
	t.false(observer.observe(live.context, live.tool));
	t.is(
		observer.commitLive(
			{
				...patch,
				expectedRevision: 1,
				sequence: 2,
				executions: [{...patch.executions[0], outcome: 'failed'}],
			},
			[
				{
					context: {...live.context, sequence: 2},
					tool: {...live.tool, status: 'failed'},
				},
			],
		),
		2,
	);
	t.is(f.repository.read(f.scope)?.executions[0].outcome, 'failed');
	t.is(
		runs.get(f.scope.projectId, f.scope.threadId, patch.executions[0].id)
			?.status,
		'failed',
	);
});

for (const operation of ['tool update', 'turn terminal'] as const) {
	test(`SUB-05 real failed live ${operation} COMMIT leaves SQL and every original observation fence unchanged`, t => {
		const f = threadHistoryFixture(t);
		const runs = agentRunRepository(f.database);
		let failCommit = false;
		const history = threadHistoryRepository({
			...f.database,
			exec: sql => {
				if (sql === 'COMMIT' && failCommit) {
					failCommit = false;
					throw new IpcFailure('INTERNAL', 'synthetic live COMMIT failure');
				}
				f.database.exec(sql);
			},
		});
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			history,
			runs,
		});
		t.teardown(() => observer.dispose());
		const patch = structuredClone(f.patch);
		patch.turns[0].outcome = 'unknown';
		patch.executions[0].outcome = 'unknown';
		const live = liveObservation(f);
		observer.commitLive(patch, [live]);
		const before = f.repository.read(f.scope);
		const rows = runs.list(f.scope.projectId, f.scope.threadId);
		const terminal =
			operation === 'turn terminal'
				? {
						context: {
							...f.scope,
							turnId: patch.turns[0].id,
							generation: 2,
							sequence: 4,
						},
						outcome: 'cancelled' as const,
					}
				: undefined;
		failCommit = true;
		t.throws(
			() =>
				observer.commitLive(
					{...patch, expectedRevision: 1, generation: 2, sequence: 4},
					[
						{
							...liveObservation(f, 2, 3),
							tool: {...live.tool, status: terminal ? 'in_progress' : 'failed'},
						},
					],
					terminal,
				),
			{code: 'INTERNAL', message: 'synthetic live COMMIT failure'},
		);
		t.deepEqual(f.repository.read(f.scope), before);
		t.deepEqual(runs.list(f.scope.projectId, f.scope.threadId), rows);
		t.true(
			observer.observe(
				{...live.context, sequence: 2},
				{...live.tool, status: 'failed'},
			),
		);
		t.true(
			observer.endTurn(
				{...f.scope, turnId: patch.turns[0].id, generation: 1, sequence: 3},
				'failed',
			),
		);
	});
}

test('SUB-05 a stale live candidate after a newer committed replay never reaches SQL or replaces its observer', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	let writes = 0;
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		runs,
		history: {
			read: f.repository.read,
			apply: (scope, patch) => {
				writes++;
				return f.repository.apply(scope, patch);
			},
		},
	});
	t.teardown(() => observer.dispose());
	const live = liveObservation(f);
	observer.commitLive(f.patch, [live]);
	observer.commitReplay(
		{...f.patch, expectedRevision: 1, generation: 2, sequence: 3},
		[observation(f, 2, 3)],
	);
	const before = f.repository.read(f.scope);
	writes = 0;
	t.throws(
		() =>
			observer.commitLive({...f.patch, expectedRevision: 1, sequence: 2}, [
				{context: {...live.context, sequence: 2}, tool: live.tool},
			]),
		{code: 'DENIED'},
	);
	t.is(writes, 0);
	t.deepEqual(f.repository.read(f.scope), before);
	t.true(
		observer.observe(
			{...live.context, generation: 2, sequence: 4},
			{...live.tool, status: 'failed'},
		),
	);
});

test('SUB-05 replay scope refuses malformed Unicode session identity before observation', t => {
	const f = threadHistoryFixture(t);
	t.throws(
		() =>
			createThreadHistoryObserver({
				scope: {...f.scope, sessionId: 'session\uD800'},
				history: f.repository,
				runs: agentRunRepository(f.database),
			}),
		{code: 'VALIDATION'},
	);
});

function observation(
	f: ReturnType<typeof threadHistoryFixture>,
	generation = 1,
	sequence = 1,
): ReplayObservation {
	const execution = f.patch.executions[0];
	return {
		context: {
			...f.scope,
			turnId: execution.turnId,
			executionId: execution.id,
			toolCallId: execution.toolCallId,
			generation,
			sequence,
			source: 'replay',
			terminalEvidence: 'replay-synthetic',
			replayEpoch: randomUUID(),
			replayCommitted: true,
		},
		tool: {
			type: 'tool',
			id: execution.toolCallId,
			status: 'completed',
			delegation: {
				role: 'explore',
				task: 'forbidden-task-sentinel',
				history: true,
			},
			details: {input: 'forbidden-input-sentinel'},
		},
	};
}

test('SUB-05 replay commits only the staged safe run metadata and retains its identities on reopen', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs,
	});
	t.teardown(() => observer.dispose());
	t.is(observer.commitReplay(f.patch, [observation(f)]), 1);
	t.deepEqual(runs.list(f.scope.projectId, f.scope.threadId), [
		{...f.patch.agentRuns[0], status: 'unknown'},
	]);
	const before = f.repository.read(f.scope);
	t.deepEqual(f.reopen().read(f.scope), before);
	t.deepEqual(
		before?.executions.map(row => row.id),
		[f.patch.executions[0].id],
	);
});

for (const target of ['SQL', 'observer memory'] as const) {
	test(`SUB-05 a failed replay commit leaves ${target} unchanged after real staging`, t => {
		const f = threadHistoryFixture(t);
		const initial = structuredClone(f.patch);
		initial.turns[0].outcome = 'unknown';
		initial.executions[0].outcome = 'unknown';
		initial.agentRuns[0].status = 'running';
		f.repository.apply(f.scope, initial);
		const before = f.repository.read(f.scope);
		const runs = agentRunRepository(f.database);
		let stagedRows: AgentRunMetadata[] = [];
		let fail = true;
		const history = threadHistoryRepository({
			...f.database,
			exec: sql => {
				if (sql === 'COMMIT' && fail) {
					fail = false;
					throw new IpcFailure('INTERNAL', 'fixture commit failed');
				}
				f.database.exec(sql);
			},
		});
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			runs,
			history: {
				read: f.repository.read,
				apply: (scope, patch) => {
					stagedRows = structuredClone(patch.agentRuns);
					return history.apply(scope, patch);
				},
			},
		});
		t.teardown(() => observer.dispose());
		const replay = observation(f, 2, 2);
		const live = {
			...replay.context,
			generation: 1,
			sequence: 1,
			source: 'live' as const,
			terminalEvidence: 'live' as const,
			replayEpoch: undefined,
			replayCommitted: undefined,
		};
		const liveTool = {
			...replay.tool,
			status: 'in_progress',
			delegation: {role: 'explore', history: false},
		};
		t.true(observer.observe(live, liveTool));
		t.throws(
			() =>
				observer.commitReplay(
					{
						...f.patch,
						expectedRevision: 1,
						generation: 2,
						sequence: 2,
					},
					[replay],
				),
			{code: 'INTERNAL'},
		);
		if (target === 'SQL') {
			t.deepEqual(f.repository.read(f.scope), before);
			t.deepEqual(
				runs.list(f.scope.projectId, f.scope.threadId),
				initial.agentRuns,
			);
		} else {
			t.false(observer.observe(live, liveTool));
			t.true(
				observer.observe(
					{...live, sequence: 2},
					{...liveTool, status: 'failed'},
				),
			);
			t.is(
				runs.get(f.scope.projectId, f.scope.threadId, live.executionId)?.status,
				'failed',
			);
		}
		t.deepEqual(stagedRows, [{...initial.agentRuns[0], status: 'unknown'}]);
	});
}

test('SUB-05 successful replay activates its observer generation only after the SQL commit', t => {
	const f = threadHistoryFixture(t);
	f.repository.apply(f.scope, f.patch);
	const runs = agentRunRepository(f.database);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs,
	});
	t.teardown(() => observer.dispose());
	const replay = observation(f, 2, 2);
	const live = {
		...replay.context,
		generation: 1,
		sequence: 1,
		source: 'live' as const,
		terminalEvidence: 'live' as const,
		replayEpoch: undefined,
		replayCommitted: undefined,
	};
	const tool = {
		...replay.tool,
		status: 'failed',
		delegation: {role: 'explore', history: false},
	};
	t.true(observer.observe(live, tool));
	observer.commitReplay(
		{...f.patch, expectedRevision: 1, generation: 2, sequence: 2},
		[replay],
	);
	t.false(observer.observe({...live, sequence: 3}, tool));
	t.is(
		runs.get(f.scope.projectId, f.scope.threadId, live.executionId)?.status,
		'failed',
	);
});

for (const kind of [
	'session',
	'turn',
	'tool',
	'generation',
	'sequence',
	'source',
	'uncommitted',
	'mixed-epoch',
	'duplicate-slot',
	'disposed',
	'removed',
	'history',
] as const) {
	test(`SUB-05 replay refuses ${kind} mismatch before committing any staged metadata`, t => {
		const f = threadHistoryFixture(t);
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			history: f.repository,
			runs: agentRunRepository(f.database),
		});
		t.teardown(() => observer.dispose());
		const entry = observation(f);
		const entries = [entry];
		const patch = {...f.patch, sequence: 2};
		if (kind === 'session') entry.context.sessionId = 'foreign-session';
		if (kind === 'turn') entry.context.turnId = randomUUID();
		if (kind === 'tool') {
			entry.context.toolCallId = 'foreign-tool';
			entry.tool.id = 'foreign-tool';
		}
		if (kind === 'generation') entry.context.generation = 2;
		if (kind === 'sequence') entry.context.sequence = 3;
		if (kind === 'source') entry.context.source = 'live';
		if (kind === 'uncommitted') entry.context.replayCommitted = false;
		if (kind === 'mixed-epoch') entries.push(observation(f, 1, 2));
		if (kind === 'duplicate-slot') entries.push(structuredClone(entry));
		if (kind === 'disposed') observer.dispose();
		if (kind === 'removed') observer.forgetThread(f.scope.threadId);
		if (kind === 'history' && entry.tool.delegation)
			entry.tool.delegation.history = false;
		t.throws(() => observer.commitReplay(patch, entries), {code: 'DENIED'});
		t.is(f.repository.read(f.scope), undefined);
		t.deepEqual(
			agentRunRepository(f.database).list(f.scope.projectId, f.scope.threadId),
			[],
		);
	});
}

for (const kind of ['tool', 'terminal'] as const) {
	test(`SUB-05 a per-thread observer refuses a foreign live ${kind} owner`, t => {
		const f = threadHistoryFixture(t);
		const runs = agentRunRepository(f.database);
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			history: f.repository,
			runs,
		});
		t.teardown(() => observer.dispose());
		const foreign = f.anotherThread();
		const entry = observation(f);
		const context = {
			...entry.context,
			...foreign,
			turnId: randomUUID(),
			executionId: randomUUID(),
			source: 'live' as const,
			terminalEvidence: 'live' as const,
			replayEpoch: undefined,
			replayCommitted: undefined,
		};
		if (kind === 'tool')
			t.false(
				observer.observe(context, {
					...entry.tool,
					delegation: {role: 'explore', history: false},
				}),
			);
		else
			t.false(
				observer.endTurn(
					{
						...foreign,
						turnId: context.turnId,
						generation: 1,
						sequence: 1,
					},
					'completed',
				),
			);
		t.deepEqual(runs.list(foreign.projectId, foreign.threadId), []);
	});
}

for (const kind of ['tool', 'terminal'] as const) {
	test(`SUB-05 an empty committed replay still rejects an older live ${kind} generation`, t => {
		const f = threadHistoryFixture(t);
		f.repository.apply(f.scope, f.patch);
		const observer = createThreadHistoryObserver({
			scope: f.scope,
			history: f.repository,
			runs: agentRunRepository(f.database),
		});
		t.teardown(() => observer.dispose());
		observer.commitReplay(
			{
				expectedRevision: 1,
				generation: 2,
				sequence: 2,
				complete: false,
				turns: [],
				executions: [],
			},
			[],
		);
		const entry = observation(f, 1, 3);
		if (kind === 'tool')
			t.false(
				observer.observe(
					{
						...entry.context,
						source: 'live',
						terminalEvidence: 'live',
						replayEpoch: undefined,
						replayCommitted: undefined,
					},
					{...entry.tool, delegation: {role: 'explore', history: false}},
				),
			);
		else
			t.false(
				observer.endTurn(
					{
						...f.scope,
						turnId: entry.context.turnId,
						generation: 1,
						sequence: 3,
					},
					'completed',
				),
			);
	});
}

test('SUB-05 replay observations cannot bypass staging through the live observer method', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs,
	});
	t.teardown(() => observer.dispose());
	const entry = observation(f);
	t.false(observer.observe(entry.context, entry.tool));
	t.deepEqual(runs.list(f.scope.projectId, f.scope.threadId), []);
});

test('SUB-05 replay staging refuses more than the bounded observation limit', t => {
	const f = threadHistoryFixture(t);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs: agentRunRepository(f.database),
	});
	t.teardown(() => observer.dispose());
	const entry = observation(f);
	const entries = Array.from({length: 10001}, (_, sequence) => ({
		...entry,
		context: {...entry.context, sequence},
	}));
	t.throws(
		() => observer.commitReplay({...f.patch, sequence: 10001}, entries),
		{code: 'VALIDATION'},
	);
	t.is(f.repository.read(f.scope), undefined);
});

test('SUB-05 the activated replay observer forwards later live and terminal metadata to SQL', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs,
	});
	t.teardown(() => observer.dispose());
	observer.commitReplay(f.patch, [observation(f)]);
	const turnId = randomUUID();
	const executionId = randomUUID();
	f.repository.apply(f.scope, {
		...f.patch,
		expectedRevision: 1,
		generation: 2,
		sequence: 2,
		agentRuns: [],
		turns: [{id: turnId, ordinal: 1, outcome: 'unknown'}],
		executions: [
			{
				id: executionId,
				turnId,
				toolCallId: 'live-tool',
				ordinal: 0,
				outcome: 'unknown',
			},
		],
	});
	const context = {
		...f.scope,
		turnId,
		executionId,
		toolCallId: 'live-tool',
		generation: 2,
		sequence: 2,
		source: 'live' as const,
		terminalEvidence: 'live' as const,
	};
	const tool: ReplayObservation['tool'] = {
		type: 'tool',
		id: 'live-tool',
		status: 'in_progress',
		delegation: {role: 'explore', history: false},
	};
	t.true(observer.observe(context, tool));
	t.false(observer.observe(context, tool));
	const terminal = {...f.scope, turnId, generation: 2, sequence: 3};
	t.true(observer.endTurn(terminal, 'failed'));
	t.false(observer.endTurn(terminal, 'failed'));
	t.false(observer.observe({...context, sequence: 4}, tool));
	t.is(
		runs.get(f.scope.projectId, f.scope.threadId, executionId)?.status,
		'failed',
	);
	t.is(
		runs.get(f.scope.projectId, f.scope.threadId, f.patch.executions[0].id)
			?.status,
		'unknown',
	);
	f.reopen();
	t.is(
		agentRunRepository(f.database).get(
			f.scope.projectId,
			f.scope.threadId,
			executionId,
		)?.status,
		'failed',
	);
});

test('SUB-05 ordinary replay tools keep their structural identities without inventing delegation metadata', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		history: f.repository,
		runs,
	});
	t.teardown(() => observer.dispose());
	const entry = observation(f);
	delete entry.tool.delegation;
	observer.commitReplay(f.patch, [entry]);
	t.deepEqual(
		f.repository.read(f.scope)?.executions.map(row => row.id),
		[entry.context.executionId],
	);
	t.deepEqual(runs.list(f.scope.projectId, f.scope.threadId), []);
});

test('SUB-05 a malformed later replay observation discards an already staged prefix', t => {
	const f = threadHistoryFixture(t);
	const runs = agentRunRepository(f.database);
	let commits = 0;
	const observer = createThreadHistoryObserver({
		scope: f.scope,
		runs,
		history: {
			read: f.repository.read,
			apply: (scope, patch) => {
				commits++;
				return f.repository.apply(scope, patch);
			},
		},
	});
	t.teardown(() => observer.dispose());
	const first = observation(f, 2, 1);
	const later = structuredClone(first);
	later.context.sequence = 2;
	later.context.sessionId = 'foreign-session';
	t.throws(
		() =>
			observer.commitReplay({...f.patch, generation: 2, sequence: 2}, [
				first,
				later,
			]),
		{code: 'DENIED'},
	);
	t.is(commits, 0);
	t.deepEqual(runs.list(f.scope.projectId, f.scope.threadId), []);
	t.is(f.repository.read(f.scope), undefined);
	t.true(
		observer.observe(
			{
				...first.context,
				generation: 1,
				source: 'live',
				terminalEvidence: 'live',
				replayCommitted: undefined,
				replayEpoch: undefined,
			},
			{...first.tool, delegation: {role: 'explore', history: false}},
		),
	);
});
