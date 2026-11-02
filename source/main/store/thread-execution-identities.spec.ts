import {randomUUID} from 'node:crypto';
import test from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {agentRunRepository} from '@/main/store/agent-runs';
import {threadHistoryFixture as fixture} from '@/main/store/fixtures/thread-history';
import {transaction} from '@/main/store/migrations';

test('SUB-05 well-formed Unicode opaque tool identities round-trip exactly', t => {
	const f = fixture(t);
	const patch = structuredClone(f.patch);
	patch.executions[0].toolCallId = 'opaque/é/\u{1F680}';
	f.repository.apply(f.scope, patch);
	t.is(
		f.repository.read(f.scope)?.executions[0].toolCallId,
		patch.executions[0].toolCallId,
	);
	t.is(
		f.reopen().read(f.scope)?.executions[0].toolCallId,
		patch.executions[0].toolCallId,
	);
});

import {threadHistoryRepository} from '@/main/store/thread-execution-identities';

test('CHAT-08 SUB-05 a committed structural identity and safe run metadata survive store reopen unchanged', t => {
	const f = fixture(t);
	t.is(f.repository.apply(f.scope, f.patch), 1);
	const expected = {
		revision: 1,
		generation: 1,
		sequence: 1,
		complete: true,
		turns: f.patch.turns,
		executions: f.patch.executions,
	};
	t.deepEqual(f.repository.read(f.scope), expected);
	t.deepEqual(f.reopen().read(f.scope), expected);
	t.deepEqual(
		agentRunRepository(f.database).list(f.scope.projectId, f.scope.threadId),
		f.patch.agentRuns,
	);
});

for (const target of ['project', 'thread', 'session'] as const) {
	test(`SUB-05 identity commits refuse a foreign ${target} scope before writing`, t => {
		const f = fixture(t);
		const scope = {...f.scope};
		if (target === 'project') scope.projectId = randomUUID();
		if (target === 'thread') scope.threadId = randomUUID();
		if (target === 'session') scope.sessionId = 'foreign-session';
		t.throws(() => f.repository.apply(scope, {...f.patch, agentRuns: []}), {
			code: 'DENIED',
		});
		t.deepEqual(f.database.prepare('SELECT * FROM thread_history').all(), []);
	});
}

for (const kind of ['revision', 'generation', 'sequence'] as const) {
	test(`SUB-05 a stale ${kind} cannot overwrite committed identity or run metadata`, t => {
		const f = fixture(t);
		f.repository.apply(f.scope, f.patch);
		const before = f.repository.read(f.scope);
		const patch = {
			...f.patch,
			expectedRevision: 1,
			generation: 1,
			sequence: 2,
			turns: [],
			executions: [],
			agentRuns: [],
		};
		if (kind === 'revision') patch.expectedRevision = 0;
		if (kind === 'generation') patch.generation = 0;
		if (kind === 'sequence') patch.sequence = 1;
		t.throws(() => f.repository.apply(f.scope, patch), {code: 'DENIED'});
		t.deepEqual(f.repository.read(f.scope), before);
		t.deepEqual(
			agentRunRepository(f.database).list(f.scope.projectId, f.scope.threadId),
			f.patch.agentRuns,
		);
	});
}

for (const target of ['scope', 'patch', 'turn', 'execution', 'run'] as const) {
	test(`DATA-07 structural commits reject payload fields on ${target} without any write`, t => {
		const f = fixture(t);
		const scope = structuredClone(f.scope);
		const patch = structuredClone(f.patch);
		const value = {
			scope,
			patch,
			turn: patch.turns[0],
			execution: patch.executions[0],
			run: patch.agentRuns[0],
		}[target];
		Object.assign(value, {prompt: 'forbidden-fixture-sentinel'});
		t.throws(() => f.repository.apply(scope, patch), {code: 'VALIDATION'});
		for (const table of [
			'thread_history',
			'thread_turn_identity',
			'thread_execution_identity',
			'agent_run',
		])
			t.deepEqual(f.database.prepare(`SELECT * FROM ${table}`).all(), []);
	});
}

for (const kind of [
	'session-size',
	'tool-size',
	'tool-bytes',
	'tool-control',
	'tool-unicode',
	'execution-id',
] as const) {
	test(`DATA-07 identity validation refuses ${kind} before writing`, t => {
		const f = fixture(t);
		const scope = structuredClone(f.scope);
		const patch = structuredClone(f.patch);
		if (kind === 'session-size') scope.sessionId = 's'.repeat(201);
		if (kind === 'tool-size') patch.executions[0].toolCallId = 'x'.repeat(513);
		if (kind === 'tool-bytes') patch.executions[0].toolCallId = 'é'.repeat(257);
		if (kind === 'tool-control')
			patch.executions[0].toolCallId = 'tool\u202ecall';
		if (kind === 'tool-unicode')
			patch.executions[0].toolCallId = 'tool\uD800call';
		if (kind === 'execution-id') patch.executions[0].id = 'not-a-uuid';
		t.throws(() => f.repository.apply(scope, patch), {code: 'VALIDATION'});
		t.is(f.repository.read(f.scope), undefined);
	});
}

for (const kind of ['turn', 'execution'] as const) {
	test(`SUB-05 a ${kind} identity cannot be reassigned to another thread`, t => {
		const f = fixture(t);
		f.repository.apply(f.scope, f.patch);
		const before = f.repository.read(f.scope);
		const other = f.anotherThread();
		const turn = {
			...f.patch.turns[0],
			id: kind === 'turn' ? f.patch.turns[0].id : randomUUID(),
		};
		const patch = {
			...f.patch,
			agentRuns: [],
			turns: [turn],
			executions:
				kind === 'turn' ? [] : [{...f.patch.executions[0], turnId: turn.id}],
		};
		t.throws(() => f.repository.apply(other, patch), {code: 'DENIED'});
		t.deepEqual(f.repository.read(f.scope), before);
		t.is(f.repository.read(other), undefined);
	});
}

for (const kind of ['turn-order', 'tool-id', 'tool-order'] as const) {
	test(`SUB-05 a committed identity refuses changed ${kind}`, t => {
		const f = fixture(t);
		f.repository.apply(f.scope, f.patch);
		const before = f.repository.read(f.scope);
		const patch = {
			...structuredClone(f.patch),
			expectedRevision: 1,
			sequence: 2,
		};
		if (kind === 'turn-order') patch.turns[0].ordinal = 1;
		if (kind === 'tool-id') patch.executions[0].toolCallId = 'different-tool';
		if (kind === 'tool-order') patch.executions[0].ordinal = 1;
		t.throws(() => f.repository.apply(f.scope, patch), {code: 'DENIED'});
		t.deepEqual(f.repository.read(f.scope), before);
	});
}

test('SUB-05 synthetic replay cannot turn a known failed execution or run into success', t => {
	const f = fixture(t);
	f.repository.apply(f.scope, f.patch);
	const patch = {
		...structuredClone(f.patch),
		expectedRevision: 1,
		generation: 2,
		sequence: 2,
		source: 'replay' as const,
	};
	patch.turns[0].outcome = 'completed';
	patch.executions[0].outcome = 'completed';
	patch.agentRuns[0].status = 'completed';
	f.repository.apply(f.scope, patch);
	t.is(f.repository.read(f.scope)?.executions[0].outcome, 'failed');
	t.is(f.repository.read(f.scope)?.turns[0].outcome, 'failed');
	t.is(
		agentRunRepository(f.database).get(
			f.scope.projectId,
			f.scope.threadId,
			patch.agentRuns[0].id,
		)?.status,
		'failed',
	);
});

test('SUB-05 imported synthetic replay records unknown rather than an invented successful outcome', t => {
	const f = fixture(t);
	const patch = {...structuredClone(f.patch), source: 'replay' as const};
	patch.turns[0].outcome = 'completed';
	patch.executions[0].outcome = 'completed';
	patch.agentRuns[0].status = 'completed';
	f.repository.apply(f.scope, patch);
	t.is(f.repository.read(f.scope)?.executions[0].outcome, 'unknown');
	t.is(f.repository.read(f.scope)?.turns[0].outcome, 'unknown');
	t.is(
		agentRunRepository(f.database).get(
			f.scope.projectId,
			f.scope.threadId,
			patch.agentRuns[0].id,
		)?.status,
		'unknown',
	);
});

test('SUB-05 a failed SQL commit rolls identity and agent rows back together', t => {
	const f = fixture(t);
	f.repository.apply(f.scope, f.patch);
	const before = f.repository.read(f.scope);
	let fail = true;
	const repository = threadHistoryRepository({
		...f.database,
		exec: sql => {
			if (sql === 'COMMIT' && fail) {
				fail = false;
				throw new IpcFailure('INTERNAL', 'fixture commit failed');
			}
			f.database.exec(sql);
		},
	});
	const turnId = randomUUID();
	const executionId = randomUUID();
	t.throws(
		() =>
			repository.apply(f.scope, {
				...f.patch,
				expectedRevision: 1,
				generation: 2,
				sequence: 2,
				turns: [{id: turnId, ordinal: 1, outcome: 'unknown'}],
				executions: [
					{
						id: executionId,
						turnId,
						toolCallId: 'new-tool',
						ordinal: 0,
						outcome: 'unknown',
					},
				],
				agentRuns: [
					{...f.patch.agentRuns[0], id: executionId, status: 'running'},
				],
			}),
		{code: 'INTERNAL'},
	);
	t.deepEqual(f.repository.read(f.scope), before);
	t.deepEqual(
		agentRunRepository(f.database).list(f.scope.projectId, f.scope.threadId),
		f.patch.agentRuns,
	);
});

for (const target of ['thread', 'project'] as const) {
	test(`SUB-05 removing a ${target} cascades all structural identities and run metadata`, t => {
		const f = fixture(t);
		f.repository.apply(f.scope, f.patch);
		f.database
			.prepare(`DELETE FROM ${target} WHERE id=?`)
			.run(target === 'thread' ? f.scope.threadId : f.scope.projectId);
		for (const table of [
			'thread_history',
			'thread_turn_identity',
			'thread_execution_identity',
			'agent_run',
		])
			t.deepEqual(f.database.prepare(`SELECT * FROM ${table}`).all(), []);
	});
}

for (const kind of [
	'turn-id',
	'turn-slot',
	'execution-id',
	'tool-slot',
	'tool-id',
	'run-id',
] as const) {
	test(`SUB-05 identity patches refuse a duplicate ${kind} without writing`, t => {
		const f = fixture(t);
		const patch = structuredClone(f.patch);
		if (kind === 'turn-id') patch.turns.push({...patch.turns[0]});
		if (kind === 'turn-slot')
			patch.turns.push({...patch.turns[0], id: randomUUID()});
		if (kind === 'execution-id')
			patch.executions.push({...patch.executions[0]});
		if (kind === 'tool-slot')
			patch.executions.push({
				...patch.executions[0],
				id: randomUUID(),
				toolCallId: 'another-tool',
			});
		if (kind === 'tool-id')
			patch.executions.push({
				...patch.executions[0],
				id: randomUUID(),
				ordinal: 1,
			});
		if (kind === 'run-id') patch.agentRuns.push({...patch.agentRuns[0]});
		t.throws(() => f.repository.apply(f.scope, patch), {code: 'DENIED'});
		t.is(f.repository.read(f.scope), undefined);
		t.deepEqual(
			agentRunRepository(f.database).list(f.scope.projectId, f.scope.threadId),
			[],
		);
	});
}

test('SUB-05 incremental commits cannot exceed the bounded readable execution ledger', t => {
	const f = fixture(t);
	f.repository.apply(f.scope, f.patch);
	const insert = f.database.prepare(
		`INSERT INTO thread_execution_identity (id,thread_id,session_id,turn_id,tool_call_id,ordinal,outcome)
		VALUES (?,?,?,?,?,?,'unknown')`,
	);
	transaction(f.database, () => {
		for (let index = 1; index < 10000; index++)
			insert.run(
				randomUUID(),
				f.scope.threadId,
				f.scope.sessionId,
				f.patch.turns[0].id,
				`bounded-${index}`,
				index,
			);
	});
	const turnId = randomUUID();
	t.throws(
		() =>
			f.repository.apply(f.scope, {
				...f.patch,
				expectedRevision: 1,
				sequence: 2,
				agentRuns: [],
				turns: [{id: turnId, ordinal: 1, outcome: 'unknown'}],
				executions: [
					{
						...f.patch.executions[0],
						id: randomUUID(),
						turnId,
						toolCallId: 'overflow-tool',
					},
				],
			}),
		{code: 'DENIED'},
	);
	const history = f.repository.read(f.scope);
	t.is(history?.revision, 1);
	t.is(history?.turns.length, 1);
	t.is(history?.executions.length, 10000);
});
