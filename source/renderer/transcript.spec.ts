import test from 'ava';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
} from '@/renderer/transcript';

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
	t.deepEqual(
		applyEvent(emptyTranscript, {type: 'thought', text: 'Checking'}),
		{
			items: [{kind: 'thought', text: 'Checking'}],
			permissions: [],
		},
	);
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
	t.deepEqual(transcript.items, [
		{kind: 'user', text: 'Earlier question'},
		{kind: 'agent', text: 'Earlier answer'},
		{kind: 'tool', id: 'c1', title: 'ls', status: 'completed'},
	]);
	t.deepEqual(transcript.permissions, []);
});

test('joins consecutive agent text into one message', t => {
	let transcript = addUserMessage(emptyTranscript, 'Hi');
	transcript = applyEvent(transcript, {type: 'text', text: 'Hello, '});
	transcript = applyEvent(transcript, {type: 'text', text: 'there.'});
	t.deepEqual(transcript.items, [
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
