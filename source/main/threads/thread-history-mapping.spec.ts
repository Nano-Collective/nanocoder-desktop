import {randomUUID} from 'node:crypto';
import test from 'ava';
import type {ThreadHistory} from '@/main/store/thread-execution-identities';
import {mapThreadReplay} from '@/main/threads/thread-history-mapping';
import type {TurnEvent} from '@/shared/ipc';

function replay() {
	return {
		scope: {
			projectId: randomUUID(),
			threadId: randomUUID(),
			sessionId: 'unicode/session/é/\u{1F680}',
		},
		generation: 2,
		firstSequence: 10,
		epoch: randomUUID(),
		events: [
			{type: 'user', text: 'private prompt sentinel'},
			{
				type: 'tool',
				id: 'provider/opaque-id',
				title: 'private task sentinel',
				status: 'completed',
				delegation: {role: 'explore', history: false},
				details: {input: 'private input sentinel'},
			},
			{type: 'text', text: 'private answer sentinel'},
		] satisfies TurnEvent[],
	};
}

test('SUB-05 mapper allocates structural IDs and inert observations without persisting replay content', t => {
	const input = replay();
	const original = structuredClone(input);
	const mapped = mapThreadReplay(input);
	t.true(mapped.patch.complete);
	t.is(mapped.patch.expectedRevision, null);
	t.is(mapped.patch.sequence, 13);
	t.is(mapped.patch.generation, 2);
	t.is(mapped.patch.turns.length, 1);
	t.is(mapped.patch.executions.length, 1);
	t.like(mapped.patch.turns[0], {ordinal: 0, outcome: 'unknown'});
	t.like(mapped.patch.executions[0], {
		turnId: mapped.patch.turns[0].id,
		toolCallId: 'provider/opaque-id',
		ordinal: 0,
		outcome: 'unknown',
	});
	t.like(mapped.observations[0].context, {
		...input.scope,
		turnId: mapped.patch.turns[0].id,
		executionId: mapped.patch.executions[0].id,
		toolCallId: 'provider/opaque-id',
		generation: 2,
		sequence: 11,
		source: 'replay',
		terminalEvidence: 'replay-synthetic',
		replayEpoch: input.epoch,
		replayCommitted: true,
	});
	t.like(mapped.observations[0].tool, {
		history: {outcome: 'unknown'},
		delegation: {role: 'explore', history: true},
	});
	t.deepEqual(input, original);
	for (const field of ['prompt', 'task', 'input', 'answer'])
		t.false(JSON.stringify(mapped.patch).includes(`private ${field} sentinel`));
});

function historyOf(mapped: ReturnType<typeof mapThreadReplay>): ThreadHistory {
	return {
		revision: 1,
		generation: mapped.patch.generation,
		sequence: mapped.patch.sequence,
		complete: mapped.patch.complete,
		turns: structuredClone(mapped.patch.turns),
		executions: structuredClone(mapped.patch.executions),
	};
}

test('SUB-05 exact complete replay reuses UUIDs independently of prompt title task and answer content', t => {
	const input = replay();
	const history = historyOf(mapThreadReplay(input));
	const changed = structuredClone(input.events);
	changed[0].text = 'different private prompt';
	changed[1].title = 'different private title';
	if (changed[1].details) changed[1].details.input = 'different private input';
	changed[2].text = 'different private answer';
	const again = mapThreadReplay({
		...input,
		events: changed,
		history,
		generation: 3,
		firstSequence: 20,
		epoch: randomUUID(),
	});
	t.deepEqual(again.patch.turns, history.turns);
	t.deepEqual(again.patch.executions, history.executions);
	t.is(again.patch.expectedRevision, 1);
	t.is(again.observations[0].context.executionId, history.executions[0].id);
});

for (const outcome of ['completed', 'failed', 'interrupted'] as const) {
	test(`SUB-05 synthetic replay retains previously justified ${outcome} identity and observation`, t => {
		const input = replay();
		const history = historyOf(mapThreadReplay(input));
		history.turns[0].outcome = outcome;
		history.executions[0].outcome = outcome;
		const again = mapThreadReplay({
			...input,
			history,
			generation: 3,
			firstSequence: 20,
		});
		t.deepEqual(again.patch.turns, history.turns);
		t.deepEqual(again.patch.executions, history.executions);
		t.like(again.observations[0], {
			context: {terminalEvidence: 'previously-known'},
			tool: {
				history: {outcome},
				status: outcome === 'interrupted' ? 'cancelled' : outcome,
			},
		});
	});
}

test('SUB-05 synthetic completion without prior evidence is unknown in both tool and observation', t => {
	const mapped = mapThreadReplay(replay());
	t.like(mapped.observations[0], {
		context: {terminalEvidence: 'replay-synthetic'},
		tool: {status: 'unknown', history: {outcome: 'unknown'}},
	});
});

for (const edit of [
	'truncated',
	'inserted',
	'changed',
	'missing-boundary',
] as const) {
	test(`SUB-05 ${edit} replay keeps old metadata but creates no guessed durable association`, t => {
		const input = replay();
		const history = historyOf(mapThreadReplay(input));
		history.executions[0].outcome = 'failed';
		const before = structuredClone(history);
		let events: TurnEvent[] = structuredClone(input.events);
		if (edit === 'truncated')
			events = events.filter(event => event.type !== 'tool');
		else if (edit === 'inserted')
			events.unshift({type: 'user', text: 'inserted boundary'});
		else if (edit === 'changed')
			events = events.map(event =>
				event.type === 'tool' ? {...event, id: 'different/opaque-id'} : event,
			);
		else events = events.filter(event => event.type !== 'user');
		const mapped = mapThreadReplay({
			...input,
			history,
			events,
			generation: 3,
			firstSequence: 20,
		});
		t.false(mapped.patch.complete);
		t.deepEqual(mapped.patch.turns, []);
		t.deepEqual(mapped.patch.executions, []);
		t.deepEqual(mapped.observations, []);
		t.is(mapped.patch.expectedRevision, 1);
		t.is(mapped.events.length, events.length);
		t.deepEqual(history, before);
	});
}

test('SUB-05 a prior incomplete mapping never authorises UUID reuse or a replacement join', t => {
	const input = replay();
	const history = {...historyOf(mapThreadReplay(input)), complete: false};
	const mapped = mapThreadReplay({
		...input,
		history,
		generation: 3,
		firstSequence: 20,
	});
	t.false(mapped.patch.complete);
	t.deepEqual(mapped.patch.turns, []);
	t.deepEqual(mapped.patch.executions, []);
	t.deepEqual(mapped.observations, []);
	t.like(
		mapped.events.find(event => event.type === 'tool'),
		{
			status: 'unknown',
			history: {outcome: 'unknown'},
		},
	);
});

for (const shape of [
	'duplicate-in-turn',
	'duplicate-across-turns',
	'repeated-empty-turns',
	'unsupported-boundary',
] as const) {
	test(`SUB-05 ${shape} import stays readable but withholds durable C associations`, t => {
		const input = replay();
		const events: TurnEvent[] = structuredClone(input.events);
		if (shape === 'duplicate-in-turn') events.push({...input.events[1]});
		else if (shape === 'duplicate-across-turns')
			events.push({type: 'user', text: 'later turn'}, {...input.events[1]});
		else if (shape === 'repeated-empty-turns')
			events.push(
				{type: 'user', text: 'empty one'},
				{type: 'user', text: 'empty two'},
			);
		else events.push({type: 'subagent', id: 'unproven root boundary'});
		const mapped = mapThreadReplay({...input, events});
		t.false(mapped.patch.complete);
		t.deepEqual(mapped.patch.turns, []);
		t.deepEqual(mapped.patch.executions, []);
		t.deepEqual(mapped.observations, []);
		t.is(mapped.events.length, events.length);
	});
}

test('SUB-05 reordering an exact tool set is not an ordered identity proof', t => {
	const input = replay();
	const events: TurnEvent[] = [
		...input.events,
		{type: 'tool', id: 'second/tool', status: 'completed'},
	];
	const history = historyOf(mapThreadReplay({...input, events}));
	const reordered = [events[0], events[3], events[2], events[1]];
	const mapped = mapThreadReplay({
		...input,
		history,
		events: reordered,
		generation: 3,
		firstSequence: 20,
	});
	t.false(mapped.patch.complete);
	t.deepEqual(mapped.observations, []);
});

for (const event of [
	{
		type: 'permission',
		request: {
			id: 'request',
			title: 'never reopen',
			options: [{id: 'allow', name: 'allow', kind: 'allow_once'}],
		},
	},
	{type: 'permission-closed', id: 'request'},
] satisfies TurnEvent[]) {
	test(`SUB-05 replay refuses live-only ${event.type} before any prefix or observation can commit`, t => {
		const input = replay();
		t.throws(
			() => mapThreadReplay({...input, events: [...input.events, event]}),
			{
				code: 'DENIED',
				message: 'The replay contains live-only updates',
			},
		);
	});
}

for (const budget of ['events', 'bytes'] as const) {
	test(`SUB-05 replay exceeding the ${budget} budget refuses rather than publishing a partial prefix`, t => {
		const input = replay();
		const events: TurnEvent[] =
			budget === 'events'
				? Array.from({length: 100001}, () => ({
						type: 'text',
						text: 'bounded fixture',
					}))
				: [{type: 'user', text: 'x'.repeat(16 * 1024 * 1024)}];
		t.throws(() => mapThreadReplay({...input, events}), {
			code: 'VALIDATION',
			message: 'The replay history is too large',
		});
	});
}

test('SUB-05 an invalid observation slot cannot hide behind a valid replay high-water mark', t => {
	t.throws(() => mapThreadReplay({...replay(), firstSequence: -1}), {
		code: 'VALIDATION',
	});
});

test('SUB-05 a 10001-event replay preserves both sides of the reserved batch boundary without overlapping observation slots', t => {
	const input = replay();
	const events: TurnEvent[] = Array.from({length: 10001}, () => ({
		type: 'text',
		text: 'bounded fixture',
	}));
	events[0] = {type: 'user', text: 'boundary fixture'};
	events[9999] = {type: 'tool', id: 'before/boundary', status: 'completed'};
	events[10000] = {type: 'tool', id: 'after/boundary', status: 'completed'};
	const mapped = mapThreadReplay({...input, events});
	t.true(mapped.patch.complete);
	t.is(mapped.events.length, 10001);
	t.deepEqual(
		mapped.observations.map(item => item.context.sequence),
		[10009, 10011],
	);
	t.deepEqual(
		mapped.patch.executions.map(item => item.toolCallId),
		['before/boundary', 'after/boundary'],
	);
	t.is(mapped.patch.sequence, 10012);
});

test('SUB-05 a genuine empty replay is complete only when it does not contradict a prior ledger', t => {
	const input = replay();
	const empty = mapThreadReplay({...input, events: []});
	t.true(empty.patch.complete);
	t.deepEqual(empty.patch.turns, []);
	t.deepEqual(empty.observations, []);
	const history = historyOf(mapThreadReplay(input));
	const changed = mapThreadReplay({
		...input,
		events: [],
		history,
		generation: 3,
		firstSequence: 20,
	});
	t.false(changed.patch.complete);
	t.deepEqual(changed.patch.turns, []);
	t.deepEqual(changed.observations, []);
});
