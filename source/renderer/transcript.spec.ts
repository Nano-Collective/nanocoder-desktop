import test from 'ava';
import {
	addUserMessage,
	applyEvent,
	emptyTranscript,
} from '@/renderer/transcript';

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
