import test from 'ava';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
} from '@/renderer/transcript';

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

test('shows a permission request until it closes', t => {
	const request = {
		id: 'permission-1',
		title: 'execute_bash: ls',
		options: [{id: 'allow', name: 'Allow', kind: 'allow_once' as const}],
	};
	let transcript = applyEvent(emptyTranscript, {type: 'permission', request});
	t.deepEqual(transcript.permission, request);

	transcript = applyEvent(transcript, {type: 'permission-closed', id: 'other'});
	t.deepEqual(transcript.permission, request);

	transcript = applyEvent(transcript, {
		type: 'permission-closed',
		id: 'permission-1',
	});
	t.is(transcript.permission, null);
});
