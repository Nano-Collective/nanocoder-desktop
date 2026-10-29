import type {SessionUpdate} from '@agentclientprotocol/sdk';
import test from 'ava';
import {toTurnEvent} from '@/main/nanocoder/turn-events';

test('maps agent text', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'agent_message_chunk',
			content: {type: 'text', text: 'Hello'},
		}),
		{type: 'text', text: 'Hello'},
	);
});

test('maps a user message only when building history', t => {
	const chunk = {
		sessionUpdate: 'user_message_chunk' as const,
		content: {type: 'text' as const, text: 'Earlier question'},
	};
	t.deepEqual(toTurnEvent(chunk, {history: true}), {
		type: 'user',
		text: 'Earlier question',
	});
	// A live echo would show the message twice, because the UI adds it when it is sent.
	t.is(toTurnEvent(chunk), undefined);
	t.is(toTurnEvent(chunk, {history: false}), undefined);
	t.deepEqual(
		toTurnEvent(
			{
				sessionUpdate: 'user_message_chunk',
				content: {type: 'image', data: 'AA==', mimeType: 'image/png'},
			},
			{history: true},
		),
		{type: 'user', text: '[image not displayed]'},
	);
});

test('drops an empty text chunk, which only carries metadata', t => {
	for (const sessionUpdate of [
		'agent_message_chunk',
		'user_message_chunk',
	] as const) {
		t.is(
			toTurnEvent(
				{sessionUpdate, content: {type: 'text', text: ''}},
				{history: true},
			),
			undefined,
		);
	}
});

test('represents unsupported media without forwarding resource data (CHAT-05)', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'agent_message_chunk',
			content: {type: 'image', data: 'AA==', mimeType: 'image/png'},
		}),
		{type: 'text', text: '[image not displayed]'},
	);
});

const updates: {update: SessionUpdate; expected: unknown}[] = [
	{
		update: {
			sessionUpdate: 'plan',
			entries: [{content: 'test first', priority: 'high', status: 'pending'}],
		},
		expected: {
			type: 'plan',
			id: null,
			content: {
				kind: 'items',
				entries: [{content: 'test first', priority: 'high', status: 'pending'}],
			},
		},
	},
	{
		update: {
			sessionUpdate: 'plan_update',
			plan: {type: 'markdown', planId: 'p', content: '# plan'},
		},
		expected: {
			type: 'plan',
			id: 'p',
			content: {kind: 'markdown', text: '# plan'},
		},
	},
	{
		update: {
			sessionUpdate: 'plan_update',
			plan: {type: 'file', planId: 'p', uri: 'file:///fixture/plan.md'},
		},
		expected: {
			type: 'plan',
			id: 'p',
			content: {kind: 'file', uri: 'file:///fixture/plan.md'},
		},
	},
	{
		update: {sessionUpdate: 'plan_removed', planId: 'p'},
		expected: {type: 'plan', id: 'p', content: null},
	},
	{
		update: {sessionUpdate: 'current_mode_update', currentModeId: 'plan'},
		expected: {type: 'mode', id: 'plan'},
	},
	{
		update: {
			sessionUpdate: 'config_option_update',
			configOptions: [
				{id: 'thinking', name: 'thinking', type: 'boolean', currentValue: true},
			],
		},
		expected: {
			type: 'config',
			options: [{id: 'thinking', name: 'thinking', value: true}],
		},
	},
	{
		update: {
			sessionUpdate: 'session_info_update',
			title: 'owned by thread service',
			updatedAt: '2026-10-27T12:00:00Z',
		},
		expected: undefined,
	},
	{
		update: {
			sessionUpdate: 'usage_update',
			used: 12,
			size: 100,
			cost: {amount: 0.5, currency: 'USD'},
		},
		expected: {
			type: 'context',
			used: 12,
			size: 100,
			cost: {amount: 0.5, currency: 'USD'},
		},
	},
	{
		update: {
			sessionUpdate: 'notice',
			severity: 'warning',
			title: 'fixture warning',
			description: 'plain detail',
		},
		expected: {
			type: 'notice',
			severity: 'warning',
			title: 'fixture warning',
			description: 'plain detail',
		},
	},
	{
		update: {
			sessionUpdate: 'compaction_update',
			compactionId: 'c',
			status: 'completed',
			summary: [{type: 'text', text: 'shorter context'}],
			error: null,
		},
		expected: {
			type: 'compaction',
			id: 'c',
			status: 'completed',
			summary: 'shorter context',
			error: null,
		},
	},
	{
		update: {
			sessionUpdate: 'compaction_summary_chunk',
			compactionId: 'c',
			content: {type: 'text', text: 'next'},
		},
		expected: {type: 'compaction-chunk', id: 'c', text: 'next'},
	},
	{
		update: {
			sessionUpdate: 'subagent_update',
			sessionId: 'child',
			title: 'investigate',
			state: {state: 'running'},
			capabilities: {cancel: {}},
		},
		expected: {
			type: 'subagent',
			id: 'child',
			title: 'investigate',
			state: 'running',
		},
	},
	{
		update: {
			sessionUpdate: 'session_message',
			messageId: 'm',
			senderSessionId: 'child',
			content: [{type: 'text', text: 'message'}],
		},
		expected: {
			type: 'session-message',
			id: 'm',
			sender: 'child',
			text: 'message',
			append: false,
		},
	},
	{
		update: {
			sessionUpdate: 'session_message_chunk',
			messageId: 'm',
			recipientSessionId: 'child',
			content: {type: 'text', text: 'next'},
		},
		expected: {
			type: 'session-message',
			id: 'm',
			recipient: 'child',
			text: 'next',
			append: true,
		},
	},
];

for (const [index, {update, expected}] of updates.entries()) {
	test(`maps SDK update ${index}: ${update.sessionUpdate} (ACP-12 CHAT-05)`, t => {
		t.deepEqual(toTurnEvent(update), expected);
	});
}

test('preserves message IDs to keep distinct agent messages distinct (CHAT-05)', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'agent_message_chunk',
			messageId: 'answer-2',
			content: {type: 'text', text: 'answer'},
		}),
		{type: 'text', text: 'answer', messageId: 'answer-2'},
	);
});

test('tool details are bounded text and content arrays replace rather than append (CHAT-05)', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'tool_call_update',
			toolCallId: 'tool',
			content: [
				{type: 'diff', path: '/fixture/a', oldText: 'old', newText: 'new'},
			],
			rawOutput: {result: 'fixture'},
			locations: [{path: '/fixture/a', line: 3}],
		}),
		{
			type: 'tool',
			id: 'tool',
			title: undefined,
			status: undefined,
			details: {
				content: ['diff /fixture/a\n---\nold\n+++\nnew'],
				output: '{"result":"fixture"}',
				locations: [{path: '/fixture/a', line: 3}],
			},
		},
	);
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'tool_call_update',
			toolCallId: 'tool',
			content: [],
		}),
		{
			type: 'tool',
			id: 'tool',
			title: undefined,
			status: undefined,
			details: {content: []},
		},
	);
});

test('maps a tool call and its updates', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'tool_call',
			toolCallId: 'c1',
			title: 'execute_bash: ls',
		}),
		{type: 'tool', id: 'c1', title: 'execute_bash: ls', status: 'pending'},
	);
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'tool_call',
			toolCallId: 'c1',
			title: 'execute_bash: ls',
			status: 'in_progress',
		}),
		{type: 'tool', id: 'c1', title: 'execute_bash: ls', status: 'in_progress'},
	);
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'tool_call_update',
			toolCallId: 'c1',
			status: 'completed',
		}),
		{type: 'tool', id: 'c1', title: undefined, status: 'completed'},
	);
});

test('maps reasoning without treating it as an agent answer (CHAT-05)', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'agent_thought_chunk',
			content: {type: 'text', text: 'hmm'},
		}),
		{type: 'thought', text: 'hmm'},
	);
});

test('maps advertised commands and input hints without inventing desktop help (CHAT-20)', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'available_commands_update',
			availableCommands: [
				{name: 'review', description: 'Review a change', input: {hint: 'path'}},
			],
		}),
		{
			type: 'commands',
			commands: [
				{name: 'review', description: 'Review a change', inputHint: 'path'},
			],
		},
	);
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'available_commands_update',
			availableCommands: [],
		}),
		{type: 'commands', commands: []},
	);
});

test('preserves replay usage duration and outcome on an empty chunk (ACP-12 CHAT-19)', t => {
	t.deepEqual(
		toTurnEvent(
			{
				sessionUpdate: 'agent_message_chunk',
				content: {type: 'text', text: ''},
				_meta: {
					'nanocoder/response-usage': {
						inputTokens: 12,
						outputTokens: 8,
						totalTokens: 20,
						cost: 0.01,
					},
					'nanocoder/durationMs': 42,
					'nanocoder/outcome': 'completed',
					'nanocoder/artifacts': [{kind: 'task', path: '/fixture/task.md'}],
				},
			},
			{history: true},
		),
		{
			type: 'metadata',
			metadata: {
				usage: {inputTokens: 12, outputTokens: 8, totalTokens: 20, cost: 0.01},
				durationMs: 42,
				outcome: 'completed',
				artifacts: [{kind: 'task', path: '/fixture/task.md'}],
			},
		},
	);
});

test('projects known vendor fields without copying unknown payloads (ACP-12)', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'agent_message_chunk',
			content: {type: 'text', text: 'answer'},
			_meta: {
				'nanocoder/usage': {cost: 0.01, privatePayload: 'synthetic-private'},
				unknown: {privatePayload: 'synthetic-private'},
			},
		}),
		{type: 'text', text: 'answer', metadata: {usage: {cost: 0.01}}},
	);
});

test('malformed vendor fields report fixed names without copying payloads (ACP-12)', t => {
	const fields: string[] = [];
	const event = toTurnEvent(
		{
			sessionUpdate: 'agent_message_chunk',
			content: {type: 'text', text: 'answer'},
			_meta: {
				'nanocoder/usage': {cost: -1},
				'nanocoder/response-usage': {totalTokens: 'synthetic-private'},
				'nanocoder/durationMs': Number.POSITIVE_INFINITY,
				'nanocoder/outcome': 'synthetic-private',
				'nanocoder/artifacts': [{kind: 'task', path: 42}],
			},
		},
		{onMalformed: field => fields.push(field)},
	);
	t.deepEqual(event, {type: 'text', text: 'answer'});
	t.deepEqual(fields, [
		'nanocoder/usage',
		'nanocoder/response-usage',
		'nanocoder/durationMs',
		'nanocoder/outcome',
		'nanocoder/artifacts',
	]);
	t.false(JSON.stringify({event, fields}).includes('synthetic-private'));
});
