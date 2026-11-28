import test from 'ava';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import {
	appendFailure,
	applyEvent,
	applyEvents,
	carryFailureRows,
	carryMessageRows,
	carryMessageTimes,
	emptyTranscript,
	extractEvictedThread,
	type Transcript,
	transcriptRowId,
} from '@/renderer/transcript';

test('SUB-05 historical outcome patches keep only the enum and remain immutable and ordered', t => {
	const first = applyEvent(emptyTranscript, {
		type: 'tool',
		id: 'history',
		status: 'unknown',
		history: {outcome: 'failed'},
	});
	const previous = first.items[0];
	const next = applyEvent(first, {
		type: 'tool',
		id: 'history',
		title: 'later title',
	});
	t.like(previous, {historyOutcome: 'failed'});
	t.like(next.items[0], {historyOutcome: 'failed', title: 'later title'});
	t.is(first.items[0], previous);
	t.not(next.items[0], previous);
	t.is(next.items.length, 1);
	t.false(Object.hasOwn(previous, 'history'));
});

test('SUB-05 absent historical outcome adds no transcript field', t => {
	const state = applyEvent(emptyTranscript, {type: 'tool', id: 'history'});
	t.false(Object.hasOwn(state.items[0], 'historyOutcome'));
});

test('SUB-05 unknown history is explicit and unlisted outcomes cannot enter transcript state', t => {
	const unknown = applyEvent(emptyTranscript, {
		type: 'tool',
		id: 'unknown',
		history: {outcome: 'unknown'},
	});
	t.like(unknown.items[0], {historyOutcome: 'unknown'});
	const unlisted = applyEvent(emptyTranscript, {
		type: 'tool',
		id: 'unlisted',
		history: {outcome: 'success' as 'unknown'},
	});
	t.false(Object.hasOwn(unlisted.items[0], 'historyOutcome'));
});

test('title-only subagent-prefixed tool updates retain classification status content and opaque ID (CHAT-05)', t => {
	const full = toTurnEvent({
		sessionUpdate: 'tool_call',
		toolCallId: 'subagent:fixture',
		title: 'starting',
		kind: 'execute',
		status: 'in_progress',
		content: [
			{type: 'content', content: {type: 'text', text: 'retained content'}},
		],
		rawInput: {task: 'fixture'},
	});
	const titleOnly = toTurnEvent({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'subagent:fixture',
		title: 'still working',
	});
	t.truthy(full);
	t.truthy(titleOnly);
	if (!full || !titleOnly) return;
	const transcript = applyEvent(applyEvent(emptyTranscript, full), titleOnly);
	t.deepEqual(transcript.items, [
		{
			kind: 'tool',
			id: 'subagent:fixture',
			title: 'still working',
			status: 'in_progress',
			toolKind: 'execute',
			details: {input: '{"task":"fixture"}', content: ['retained content']},
		},
	]);
});

test('keeps reasoning separate from the agent answer (CHAT-05)', t => {
	t.like(applyEvent(emptyTranscript, {type: 'thought', text: 'Checking'}), {
		items: [{kind: 'thought', text: 'Checking'}],
		permissions: [],
	});
});

test('attaches reported usage to the answer without inferring context use (CHAT-19)', t => {
	const before = applyEvent(emptyTranscript, {type: 'text', text: 'answer'});
	t.deepEqual(
		applyEvent(before, {
			type: 'metadata',
			metadata: {
				usage: {totalTokens: 20, cost: 0.01},
				durationMs: 42,
				outcome: 'completed',
			},
		}),
		{
			items: [
				{
					kind: 'agent',
					text: 'answer',
					rowId: before.items[0].rowId,
					metadata: {
						usage: {totalTokens: 20, cost: 0.01},
						durationMs: 42,
						outcome: 'completed',
					},
				},
			],
			permissions: [],
		},
	);
});

for (const boundary of ['local', 'replayed'] as const) {
	test(`assistant-less turn metadata cannot cross a ${boundary} user boundary (CHAT-19)`, t => {
		const first = applyEvents(emptyTranscript, [
			{type: 'user', text: 'first question'},
			{type: 'text', text: 'settled answer'},
			{
				type: 'metadata',
				metadata: {usage: {totalTokens: 17}, outcome: 'completed'},
			},
		]);
		const before =
			boundary === 'local'
				? applyEvent(first, {type: 'user', text: 'next question'}, 50)
				: applyEvents(first, [{type: 'user', text: 'next question'}]);
		const after = applyEvents(before, [
			{type: 'tool', id: 'next-tool', status: 'failed'},
			{
				type: 'metadata',
				metadata: {usage: {totalTokens: 31}, outcome: 'failed'},
			},
		]);
		t.deepEqual(after.items[1].metadata, {
			usage: {totalTokens: 17},
			outcome: 'completed',
		});
		t.is(after.items[1], first.items[1]);
		t.deepEqual(after.items.at(-1), {
			kind: 'turn-metadata',
			metadata: {usage: {totalTokens: 31}, outcome: 'failed'},
		});
	});
}

test('assistant-less turns keep separate usage rows and merge only their own metadata (CHAT-19)', t => {
	const first = applyEvents(emptyTranscript, [
		{type: 'user', text: 'first question'},
		{type: 'metadata', metadata: {usage: {totalTokens: 17, cost: 0.01}}},
	]);
	const after = applyEvents(first, [
		{type: 'user', text: 'next question'},
		{type: 'metadata', metadata: {usage: {totalTokens: 31}}},
		{type: 'thought', text: 'checking'},
		{type: 'text', text: 'later answer'},
		{type: 'metadata', metadata: {durationMs: 8, outcome: 'failed'}},
	]);
	t.is(after.items[1], first.items[1]);
	t.deepEqual(after.items[1], {
		kind: 'turn-metadata',
		metadata: {usage: {totalTokens: 17, cost: 0.01}},
	});
	t.deepEqual(after.items[3], {
		kind: 'turn-metadata',
		metadata: {usage: {totalTokens: 31}, durationMs: 8, outcome: 'failed'},
	});
	t.is(after.items[5].metadata, undefined);
});

test('different reported message IDs do not merge (CHAT-05)', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'text',
		text: 'one',
		messageId: 'one',
	});
	transcript = applyEvent(transcript, {
		type: 'text',
		text: 'two',
		messageId: 'two',
	});
	t.deepEqual(transcript.items, [
		{kind: 'agent', text: 'one', messageId: 'one'},
		{kind: 'agent', text: 'two', messageId: 'two'},
	]);
});

test('plan snapshots replace in place and removal removes only that plan (ACP-12)', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'plan',
		id: 'p',
		content: {kind: 'markdown', text: 'one'},
	});
	t.deepEqual(transcript, {
		items: [{kind: 'plan', id: 'p', content: {kind: 'markdown', text: 'one'}}],
		permissions: [],
	});
	transcript = applyEvent(transcript, {type: 'text', text: 'settled'});
	const settled = transcript.items[1];
	transcript = applyEvent(transcript, {
		type: 'plan',
		id: 'p',
		content: {kind: 'markdown', text: 'two'},
	});
	t.deepEqual(transcript.items[0], {
		kind: 'plan',
		id: 'p',
		content: {kind: 'markdown', text: 'two'},
	});
	t.is(transcript.items[1], settled);
	transcript = applyEvent(transcript, {type: 'plan', id: 'p', content: null});
	t.deepEqual(transcript.items, [settled]);
});

test('compaction patches preserve omissions, clear null and append chunks in order (ACP-12)', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'compaction-chunk',
		id: 'c',
		text: 'one',
	});
	t.deepEqual(transcript, {
		items: [
			{kind: 'compaction', id: 'c', status: 'in_progress', summary: 'one'},
		],
		permissions: [],
	});
	transcript = applyEvent(transcript, {
		type: 'compaction',
		id: 'c',
		status: 'completed',
		error: 'fixture error',
	});
	transcript = applyEvent(transcript, {
		type: 'compaction-chunk',
		id: 'c',
		text: 'two',
	});
	t.deepEqual(transcript.items[0], {
		kind: 'compaction',
		id: 'c',
		status: 'completed',
		summary: 'onetwo',
		error: 'fixture error',
	});
	transcript = applyEvent(transcript, {
		type: 'compaction',
		id: 'c',
		status: 'completed',
		summary: null,
		error: null,
	});
	t.deepEqual(transcript.items[0], {
		kind: 'compaction',
		id: 'c',
		status: 'completed',
		summary: null,
		error: null,
	});
});

test('subagent metadata patches never add child actions or guessed state (ACP-12)', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'subagent',
		id: 'child',
		title: 'one',
		description: 'detail',
		state: 'running',
	});
	t.deepEqual(transcript, {
		items: [
			{
				kind: 'subagent',
				id: 'child',
				title: 'one',
				description: 'detail',
				state: 'running',
			},
		],
		permissions: [],
	});
	transcript = applyEvent(transcript, {
		type: 'subagent',
		id: 'child',
		title: null,
		state: null,
	});
	t.deepEqual(transcript.items[0], {
		kind: 'subagent',
		id: 'child',
		title: null,
		description: 'detail',
		state: null,
	});
});

test('inter-session content replaces, clears and appends while sender identity is retained (ACP-12)', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'session-message',
		id: 'm',
		sender: 'child',
		text: 'one',
		append: false,
	});
	t.deepEqual(transcript, {
		items: [{kind: 'session-message', id: 'm', sender: 'child', text: 'one'}],
		permissions: [],
	});
	transcript = applyEvent(transcript, {
		type: 'session-message',
		id: 'm',
		text: 'two',
		append: true,
	});
	transcript = applyEvent(transcript, {
		type: 'session-message',
		id: 'm',
		recipient: 'parent',
		append: false,
	});
	t.deepEqual(transcript.items[0], {
		kind: 'session-message',
		id: 'm',
		sender: 'child',
		recipient: 'parent',
		text: 'onetwo',
	});
	transcript = applyEvent(transcript, {
		type: 'session-message',
		id: 'm',
		text: '',
		append: false,
	});
	t.deepEqual(transcript.items[0], {
		kind: 'session-message',
		id: 'm',
		sender: 'child',
		recipient: 'parent',
		text: '',
	});
});

test('tool detail patches replace content without losing input or settled rows (CHAT-05)', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'tool',
		id: 'tool',
		details: {content: ['one'], input: 'input'},
	});
	t.deepEqual(transcript.items[0], {
		kind: 'tool',
		id: 'tool',
		title: 'tool',
		status: 'pending',
		details: {content: ['one'], input: 'input'},
	});
	transcript = applyEvent(transcript, {type: 'text', text: 'settled'});
	const settled = transcript.items[1];
	transcript = applyEvent(transcript, {
		type: 'tool',
		id: 'tool',
		details: {content: []},
	});
	t.deepEqual(transcript.items[0], {
		kind: 'tool',
		id: 'tool',
		title: 'tool',
		status: 'pending',
		details: {content: [], input: 'input'},
	});
	t.is(transcript.items[1], settled);
});

test('reported mode configuration context and notices remain display data (ACP-12)', t => {
	t.deepEqual(applyEvent(emptyTranscript, {type: 'mode', id: 'plan'}), {
		...emptyTranscript,
		mode: 'plan',
	});
	t.deepEqual(applyEvent(emptyTranscript, {type: 'config', options: []}), {
		...emptyTranscript,
		config: [],
	});
	t.deepEqual(
		applyEvent(emptyTranscript, {type: 'context', used: 12, size: 100}),
		{...emptyTranscript, context: {used: 12, size: 100}},
	);
	t.deepEqual(
		applyEvent(emptyTranscript, {
			type: 'notice',
			title: 'notice',
			severity: 'warning',
		}),
		{
			items: [{kind: 'notice', title: 'notice', severity: 'warning'}],
			permissions: [],
		},
	);
});

test('rebuilds a resumed thread from its replayed events', t => {
	let transcript = emptyTranscript;
	for (const event of [
		{type: 'user', text: 'Earlier question'},
		{type: 'text', text: 'Earlier answer'},
		{type: 'tool', id: 'c1', title: 'ls', status: 'completed'},
	] as const) {
		transcript = applyEvent(transcript, event);
	}
	t.like(transcript.items, [
		{kind: 'user', text: 'Earlier question'},
		{kind: 'agent', text: 'Earlier answer'},
		{kind: 'tool', id: 'c1', title: 'ls', status: 'completed'},
	]);
	t.deepEqual(transcript.permissions, []);
});

test('joins consecutive agent text into one message', t => {
	let transcript = applyEvent(emptyTranscript, {type: 'user', text: 'Hi'});
	transcript = applyEvent(transcript, {type: 'text', text: 'Hello, '});
	transcript = applyEvent(transcript, {type: 'text', text: 'there.'});
	t.like(transcript.items, [
		{kind: 'user', text: 'Hi'},
		{kind: 'agent', text: 'Hello, there.'},
	]);
});

test('starts a new agent message after a tool call', t => {
	let transcript = applyEvent(emptyTranscript, {type: 'text', text: 'One'});
	transcript = applyEvent(transcript, {
		type: 'tool',
		id: 'c1',
		title: 'ls',
		status: 'pending',
	});
	transcript = applyEvent(transcript, {type: 'text', text: 'Two'});
	t.deepEqual(
		transcript.items.map(item => item.kind),
		['agent', 'tool', 'agent'],
	);
});

test('updates a tool call by id and keeps what the update leaves out', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'tool',
		id: 'c1',
		title: 'execute_bash: ls',
		status: 'pending',
	});
	transcript = applyEvent(transcript, {
		type: 'tool',
		id: 'c1',
		status: 'completed',
	});
	transcript = applyEvent(transcript, {
		type: 'tool',
		id: 'c2',
		status: 'failed',
	});
	t.deepEqual(transcript.items, [
		{kind: 'tool', id: 'c1', title: 'execute_bash: ls', status: 'completed'},
		{kind: 'tool', id: 'c2', title: 'c2', status: 'failed'},
	]);
});

const request = (id: string) => ({
	id,
	title: `execute_bash: ${id}`,
	options: [{id: 'allow', name: 'Allow', kind: 'allow_once' as const}],
});

test('shows a permission request until it closes', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'permission',
		request: request('permission-1'),
	});
	t.deepEqual(transcript.permissions, [request('permission-1')]);

	transcript = applyEvent(transcript, {type: 'permission-closed', id: 'other'});
	t.deepEqual(transcript.permissions, [request('permission-1')]);

	transcript = applyEvent(transcript, {
		type: 'permission-closed',
		id: 'permission-1',
	});
	t.deepEqual(transcript.permissions, []);
});

test('keeps every waiting request, so none can be left unanswerable', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'permission',
		request: request('permission-1'),
	});
	transcript = applyEvent(transcript, {
		type: 'permission',
		request: request('permission-2'),
	});
	t.deepEqual(
		transcript.permissions.map(({id}) => id),
		['permission-1', 'permission-2'],
	);

	transcript = applyEvent(transcript, {
		type: 'permission-closed',
		id: 'permission-1',
	});
	t.deepEqual(
		transcript.permissions.map(({id}) => id),
		['permission-2'],
	);
});

test('does not list the same request twice', t => {
	let transcript = applyEvent(emptyTranscript, {
		type: 'permission',
		request: request('permission-1'),
	});
	transcript = applyEvent(transcript, {
		type: 'permission',
		request: request('permission-1'),
	});
	t.is(transcript.permissions.length, 1);
});

const at = (item: object) =>
	Object.hasOwn(item, 'at') ? Reflect.get(item, 'at') : 'none';

test('live user and first agent chunks take the applied time while joins and other rows add none', t => {
	let transcript = applyEvents(
		emptyTranscript,
		[
			{type: 'user', text: 'sent', messageId: 'u'},
			{type: 'thought', text: 'thinking'},
			{type: 'text', text: 'first', messageId: 'm'},
		],
		10,
	);
	transcript = applyEvent(
		transcript,
		{type: 'text', text: ' joined', messageId: 'm'},
		20,
	);
	transcript = applyEvents(
		transcript,
		[
			{type: 'tool', id: 'tool', status: 'completed'},
			{type: 'plan', id: 'plan', content: {entries: []}},
			{type: 'text', text: 'second'},
			{type: 'metadata', metadata: {durationMs: 1}},
		],
		30,
	);
	t.deepEqual(transcript.items.map(at), [10, 'none', 10, 'none', 'none', 30]);
	t.is(transcript.items[2]?.text, 'first joined');
	t.like(transcript.items[5], {
		kind: 'agent',
		text: 'second',
		metadata: {durationMs: 1},
	});
});

test('replayed or snapshot events applied without a time add no time field', t => {
	const transcript = applyEvents(emptyTranscript, [
		{type: 'user', text: 'saved'},
		{type: 'text', text: 'saved answer'},
	]);
	t.like(transcript.items, [
		{kind: 'user', text: 'saved'},
		{kind: 'agent', text: 'saved answer'},
	]);
	t.false(transcript.items.some(item => Object.hasOwn(item, 'at')));
});

test('carried times follow the shared message id and never a text prefix (A2)', t => {
	const previous = applyEvents(
		emptyTranscript,
		[
			{type: 'user', text: 'first', messageId: 'u1'},
			{type: 'text', text: 'partial', messageId: 'a1'},
			{type: 'user', text: 'second', messageId: 'u2'},
			{type: 'text', text: 'reply', messageId: 'a2'},
		],
		50,
	);
	const next = carryMessageTimes(
		previous,
		applyEvents(emptyTranscript, [
			{type: 'user', text: 'first', messageId: 'u1'},
			{type: 'text', text: 'partial and more', messageId: 'a1'},
			{type: 'user', text: 'second', messageId: 'u3'},
			{type: 'text', text: 'reply'},
		]),
	);
	t.deepEqual(next.items.map(at), [50, 50, 'none', 'none']);
});

test('id-less messages carry only on one exact text match and never by prefix (A2)', t => {
	const previous = applyEvents(
		emptyTranscript,
		[
			{type: 'user', text: 'saved'},
			{type: 'text', text: 'partial'},
			{type: 'user', text: 'twice'},
			{type: 'user', text: 'twice'},
			{type: 'text', text: 'reply'},
		],
		50,
	);
	const next = carryMessageTimes(
		previous,
		applyEvents(emptyTranscript, [
			{type: 'user', text: 'saved'},
			{type: 'text', text: 'partial and more'},
			{type: 'user', text: 'twice'},
			{type: 'text', text: 'reply', messageId: 'a9'},
		]),
	);
	t.deepEqual(next.items.map(at), [50, 'none', 'none', 'none']);
});

test('an id on only one side never carries a time (A2)', t => {
	const previous = applyEvents(
		emptyTranscript,
		[{type: 'text', text: 'reply', messageId: 'a1'}],
		50,
	);
	const next = carryMessageTimes(
		previous,
		applyEvents(emptyTranscript, [{type: 'text', text: 'reply'}]),
	);
	t.is(next.items.map(at)[0], 'none');
});

test('row identity survives streamed appends and prefers reported structural ids', t => {
	const streamed = applyEvents(emptyTranscript, [
		{type: 'text', text: 'first chunk'},
		{type: 'text', text: ' and the next chunk'},
	]);
	t.is(
		transcriptRowId(streamed.items[0], 0),
		`agent:${streamed.items[0].rowId}`,
	);
	const identified = applyEvents(emptyTranscript, [
		{type: 'text', text: 'first chunk', messageId: 'message-1'},
		{type: 'text', text: ' and the next chunk', messageId: 'message-1'},
	]);
	t.is(transcriptRowId(identified.items[0], 0), 'agent:message-1');
});

test('id-less replay rows never reuse an identity for different content', t => {
	const first = applyEvent(emptyTranscript, {
		type: 'text',
		text: 'first replay answer',
	});
	const second = applyEvent(emptyTranscript, {
		type: 'text',
		text: 'different replay answer',
	});
	t.not(
		transcriptRowId(first.items[0], 0),
		transcriptRowId(second.items[0], 0),
	);
});

test('CHAT-08 replay keeps the live row across chunk boundaries and repeated identical turns', t => {
	const previous = applyEvents(emptyTranscript, [
		{type: 'user', text: 'same question'},
		{type: 'text', text: 'first '},
		{type: 'text', text: 'answer'},
		{type: 'user', text: 'same question'},
		{type: 'text', text: 'first '},
		{type: 'text', text: 'answer'},
	]);
	const next = carryMessageRows(
		previous,
		applyEvents(emptyTranscript, [
			{type: 'user', text: 'same question'},
			{type: 'text', text: 'first answer'},
			{type: 'user', text: 'same question'},
			{type: 'text', text: 'first answer'},
		]),
	);
	t.deepEqual(
		next.items.map(transcriptRowId),
		previous.items.map(transcriptRowId),
	);
	t.is(new Set(next.items.map(transcriptRowId)).size, 4);
	const different = carryMessageRows(
		previous,
		applyEvents(emptyTranscript, [
			{type: 'user', text: 'different question'},
			{type: 'text', text: 'different answer'},
		]),
	);
	t.not(
		transcriptRowId(different.items[0], 0),
		transcriptRowId(previous.items[0], 0),
	);
});

test('CHAT-08 snapshot replacement never reuses a row for different text sharing its first chunk', t => {
	const previous = applyEvents(emptyTranscript, [
		{type: 'text', text: 'shared prefix'},
		{type: 'text', text: ' old answer'},
	]);
	const replacement = carryMessageRows(
		previous,
		applyEvents(emptyTranscript, [
			{type: 'text', text: 'shared prefix'},
			{type: 'text', text: ' new answer'},
		]),
	);
	t.not(
		transcriptRowId(previous.items[0], 0),
		transcriptRowId(replacement.items[0], 0),
	);
});

test('an empty agent message with a shared id never carries a time (A2)', t => {
	const previous = applyEvents(
		emptyTranscript,
		[{type: 'text', text: '', messageId: 'a1'}],
		50,
	);
	const next = carryMessageTimes(
		previous,
		applyEvents(emptyTranscript, [{type: 'text', text: '', messageId: 'a1'}]),
	);
	t.is(next.items.map(at)[0], 'none');
});

test('a message id on the new item never carries from an id-less earlier item (A2)', t => {
	const previous = applyEvents(
		emptyTranscript,
		[{type: 'text', text: 'reply'}],
		50,
	);
	const next = carryMessageTimes(
		previous,
		applyEvents(emptyTranscript, [
			{type: 'text', text: 'reply', messageId: 'a1'},
		]),
	);
	t.is(next.items.map(at)[0], 'none');
});

test('carrying times never overwrites a time, ignores empty agent text and keeps an unmatched transcript', t => {
	const previous = applyEvents(
		emptyTranscript,
		[
			{type: 'user', text: 'sent'},
			{type: 'text', text: ''},
		],
		1,
	);
	const stamped = applyEvent(emptyTranscript, {type: 'user', text: 'sent'}, 2);
	t.is(at(carryMessageTimes(previous, stamped).items[0]), 2);
	const unmatched = applyEvents(emptyTranscript, [
		{type: 'user', text: 'other'},
		{type: 'text', text: 'anything'},
	]);
	t.is(carryMessageTimes(previous, unmatched), unmatched);
	t.is(carryMessageTimes(emptyTranscript, unmatched), unmatched);
});

test('a failure row returns before the user message of its turn, and one of a vanished turn goes last (CHAT-04)', t => {
	const previous: Transcript = {
		items: [
			{kind: 'user', text: 'one'},
			{kind: 'agent', text: 'answer'},
			{kind: 'user', text: 'two'},
			{kind: 'failure', text: 'boom', rowId: '2:0'},
			{kind: 'user', text: 'three'},
		],
		permissions: [],
	};
	const rebuilt = applyEvents(emptyTranscript, [
		{type: 'user', text: 'one'},
		{type: 'text', text: 'answer'},
		{type: 'user', text: 'two'},
		{type: 'user', text: 'three'},
	]);
	const carried = carryFailureRows(previous, rebuilt);
	t.deepEqual(
		carried.items.map(item => item.kind),
		['user', 'agent', 'user', 'failure', 'user'],
	);
	t.is(carried.items[3], previous.items[3]);
	const shorter = applyEvents(emptyTranscript, [{type: 'user', text: 'one'}]);
	t.deepEqual(
		carryFailureRows(previous, shorter).items.map(item => item.kind),
		['user', 'failure'],
	);
	const replaced = applyEvents(emptyTranscript, [
		{type: 'user', text: 'one'},
		{type: 'user', text: 'different'},
		{type: 'user', text: 'three'},
	]);
	t.deepEqual(
		carryFailureRows(previous, replaced).items.map(item => item.kind),
		['user', 'user', 'user', 'failure'],
	);
	t.is(carryFailureRows(emptyTranscript, rebuilt), rebuilt);
});

test('non-item batches keep the transcript items reference intact (PERF-04)', t => {
	const base = applyEvents(emptyTranscript, [{type: 'user', text: 'zero'}]);
	const updated = applyEvents(base, [
		{type: 'mode', id: 'plan'},
		{type: 'context', used: 10, size: 100},
	]);
	t.is(updated.items, base.items);
	t.is(updated.mode, 'plan');
	t.deepEqual(updated.context, {used: 10, size: 100});
});

test('each failure row has its own key, so repeated failures in one turn never share a row (CHAT-04)', t => {
	const once = appendFailure(
		applyEvents(emptyTranscript, [{type: 'user', text: 'one'}]),
		'boom',
	);
	const twice = appendFailure(once, 'boom');
	const keys = twice.items
		.map((item, index) => transcriptRowId(item, index))
		.filter(key => key.startsWith('failure:'));
	t.is(keys.length, 2);
	t.is(new Set(keys).size, 2);
});

test('a batch applies every event in order and keeps the rows it does not change (PERF-04)', t => {
	const base = applyEvents(emptyTranscript, [{type: 'user', text: 'zero'}]);
	const batched = applyEvents(base, [
		{type: 'user', text: 'one'},
		{type: 'text', text: 'answer '},
		{type: 'text', text: 'more'},
		{type: 'user', text: 'two'},
	]);
	t.deepEqual(
		batched.items.map(item => ('text' in item ? item.text : '')),
		['zero', 'one', 'answer more', 'two'],
	);
	t.is(batched.items[0], base.items[0]);
	t.is(applyEvents(base, []), base);
});

test('a message time carries to one unused match only, so repeated messages never share a time (PERF-04)', t => {
	const timed = applyEvents(
		emptyTranscript,
		[{type: 'user', text: 'same'}],
		10,
	);
	const twice = applyEvents(emptyTranscript, [
		{type: 'user', text: 'same'},
		{type: 'user', text: 'same'},
	]);
	t.deepEqual(carryMessageTimes(timed, twice).items.map(at), [10, 'none']);
	const ambiguous = applyEvents(
		emptyTranscript,
		[
			{type: 'user', text: 'same'},
			{type: 'user', text: 'same'},
		],
		10,
	);
	t.deepEqual(
		carryMessageTimes(
			ambiguous,
			applyEvents(emptyTranscript, [{type: 'user', text: 'same'}]),
		).items.map(at),
		['none'],
	);
});

test('carrying times over a long history gives each message its own time (PERF-03)', t => {
	const count = 2000;
	let timed = emptyTranscript;
	for (let index = 0; index < count; index++)
		timed = applyEvent(timed, {type: 'user', text: `question ${index}`}, index);
	const untimed = applyEvents(
		emptyTranscript,
		Array.from({length: count}, (_, index) => ({
			type: 'user' as const,
			text: `question ${index}`,
		})),
	);
	t.deepEqual(
		carryMessageTimes(timed, untimed).items.map(at),
		Array.from({length: count}, (_, index) => index),
	);
});

test('an orphaned or unanchored failure stays last across multiple snapshots without attaching to another turn (CHAT-04)', t => {
	const initial = appendFailure(
		applyEvents(emptyTranscript, [{type: 'user', text: 'first turn'}]),
		'first failed',
	);
	const different = applyEvents(emptyTranscript, [
		{type: 'user', text: 'different first turn'},
		{type: 'text', text: 'reply one'},
	]);
	const afterFirst = carryFailureRows(initial, different);
	t.deepEqual(
		afterFirst.items.map(item => item.kind),
		['user', 'agent', 'failure'],
	);
	const withSecondTurn = applyEvents(emptyTranscript, [
		{type: 'user', text: 'different first turn'},
		{type: 'text', text: 'reply one'},
		{type: 'user', text: 'second turn'},
		{type: 'text', text: 'reply two'},
	]);
	const afterSecond = carryFailureRows(afterFirst, withSecondTurn);
	t.deepEqual(
		afterSecond.items.map(item => item.kind),
		['user', 'agent', 'user', 'agent', 'failure'],
	);

	// A prompt rejected before its user row appeared is explicitly unanchored.
	const unanchored = appendFailure(
		applyEvents(emptyTranscript, [{type: 'user', text: 'turn one'}]),
		'send rejected',
		false,
	);
	const afterUnanchored = carryFailureRows(
		unanchored,
		applyEvents(emptyTranscript, [
			{type: 'user', text: 'turn one'},
			{type: 'text', text: 'ok'},
			{type: 'user', text: 'turn two'},
		]),
	);
	t.deepEqual(
		afterUnanchored.items.map(item => item.kind),
		['user', 'agent', 'user', 'failure'],
	);
});

test('extractEvictedThread preserves compact anchors and live timestamps without retaining raw prompt text (PERF-04)', t => {
	const secretPrompt = 'unique-prompt-body-never-retained';
	const live = appendFailure(
		applyEvents(
			emptyTranscript,
			[
				{type: 'user', text: secretPrompt},
				{type: 'text', text: 'unique-reply-body-never-retained'},
			],
			4200,
		),
		'turn failed',
	);
	const saved = extractEvictedThread(live);
	t.truthy(saved);
	if (!saved) return;
	const serialised = JSON.stringify({
		failures: saved.failures,
		times: [...saved.times.entries()],
	});
	t.false(serialised.includes(secretPrompt));
	t.false(serialised.includes('unique-reply-body-never-retained'));
	const replayed = applyEvents(emptyTranscript, [
		{type: 'user', text: secretPrompt},
		{type: 'text', text: 'unique-reply-body-never-retained'},
		{type: 'user', text: 'later turn'},
	]);
	const restored = carryFailureRows(
		emptyTranscript,
		carryMessageTimes(emptyTranscript, replayed, saved.times),
		saved.failures,
	);
	t.deepEqual(
		restored.items.map(item => item.kind),
		['user', 'agent', 'failure', 'user'],
	);
	t.deepEqual(restored.items.map(at), [4200, 4200, 'none', 'none']);
});

test('tool-heavy replay batches update matching tool ids in order (PERF-03)', t => {
	const events: Array<Parameters<typeof applyEvent>[1]> = [
		{type: 'user', text: 'run tools'},
	];
	for (let index = 0; index < 200; index++) {
		events.push({
			type: 'tool',
			id: `tool-${index}`,
			title: `cmd ${index}`,
			status: 'in_progress',
		});
	}
	for (let index = 0; index < 200; index++) {
		events.push({
			type: 'tool',
			id: `tool-${index}`,
			status: 'completed',
		});
	}
	const result = applyEvents(emptyTranscript, events);
	t.is(result.items.length, 201);
	t.true(
		result.items
			.slice(1)
			.every(item => item.kind === 'tool' && item.status === 'completed'),
	);
});
