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

test('maps a replayed user message', t => {
	t.deepEqual(
		toTurnEvent({
			sessionUpdate: 'user_message_chunk',
			content: {type: 'text', text: 'Earlier question'},
		}),
		{type: 'user', text: 'Earlier question'},
	);
	t.is(
		toTurnEvent({
			sessionUpdate: 'user_message_chunk',
			content: {type: 'image', data: 'AA==', mimeType: 'image/png'},
		}),
		undefined,
	);
});

test('drops an empty text chunk, which only carries metadata', t => {
	for (const sessionUpdate of [
		'agent_message_chunk',
		'user_message_chunk',
	] as const) {
		t.is(
			toTurnEvent({sessionUpdate, content: {type: 'text', text: ''}}),
			undefined,
		);
	}
});

test('drops content that is not text', t => {
	t.is(
		toTurnEvent({
			sessionUpdate: 'agent_message_chunk',
			content: {type: 'image', data: 'AA==', mimeType: 'image/png'},
		}),
		undefined,
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

test('ignores updates the desktop does not show yet', t => {
	t.is(
		toTurnEvent({
			sessionUpdate: 'agent_thought_chunk',
			content: {type: 'text', text: 'hmm'},
		}),
		undefined,
	);
	t.is(
		toTurnEvent({
			sessionUpdate: 'available_commands_update',
			availableCommands: [],
		}),
		undefined,
	);
});
