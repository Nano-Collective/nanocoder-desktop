import test from 'ava';
import {
	createThreadConversations,
	type ThreadConversationState,
} from '@/renderer/thread-conversations';
import type {ProjectEvent, ThreadSnapshot, TurnEvent} from '@/shared/ipc';

const snapshot = (
	id: string,
	events: TurnEvent[] = [],
	projectId = 'project-a',
): ThreadSnapshot => ({
	thread: {
		id,
		projectId,
		title: id,
		nanocoderSessionId: null,
		mode: 'normal',
		sessionCwd: '/fixture',
		archiveState: 'active',
		runState: 'new',
		viewOnlyReason: null,
		lastActivityAt: '2026-10-30T14:00:00.000Z',
	},
	sequence: events.length ? 1 : 0,
	replaying: false,
	events,
});
const turn = (
	events: TurnEvent[],
	threadId = 'a',
	projectId = 'project-a',
): Extract<ProjectEvent, {type: 'turn'}> => ({
	type: 'turn',
	projectId,
	threadId,
	sequence: 2,
	events,
});

function fixture() {
	const changes: ThreadConversationState[] = [];
	const timers: {callback(): void; delayMs: number; cancelled: boolean}[] = [];
	const conversations = createThreadConversations({
		onChange: state => changes.push(state),
		clock: {
			schedule(callback, delayMs) {
				const timer = {callback, delayMs, cancelled: false};
				timers.push(timer);
				return () => {
					timer.cancelled = true;
				};
			},
		},
	});
	conversations.selectProject('project-a');
	conversations.selectThread('a');
	return {conversations, changes, timers};
}

test('drafts and completed outcomes are thread-owned and a pending draft never becomes an optimistic or queued prompt (CHAT-03, CHAT-04, DATA-10)', t => {
	const {conversations} = fixture();
	t.is(conversations.getState().projectId, 'project-a');
	conversations.snapshot(
		snapshot('a', [
			{type: 'user', text: 'earlier'},
			{type: 'text', text: 'settled'},
		]),
	);
	const before = conversations.getState().transcript;
	conversations.setDraft(' first ');
	const ticket = conversations.beginTurn('a');
	if (!ticket) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	t.is(ticket.text, 'first');
	t.is(conversations.getState().draft, '');
	t.is(conversations.getState().transcript, before);
	conversations.setDraft('next draft');
	t.is(conversations.beginTurn('a'), null);
	t.true(
		conversations.finishTurn(ticket, {
			ok: true,
			value: {stopReason: 'end_turn'},
		}),
	);
	t.is(conversations.getState().draft, 'next draft');
	t.is(conversations.getState().transcript, before);
	conversations.selectThread('b');
	t.is(conversations.getState().draft, '');
	conversations.setDraft('other thread');
	conversations.selectThread('a');
	t.is(conversations.getState().draft, 'next draft');
	t.deepEqual(conversations.getState().turn, {
		ok: true,
		value: {stopReason: 'end_turn'},
	});
});

test('same-id foreign projects cannot expose content or finish old turn tickets, while each memory-only draft stays scoped (CHAT-03, DATA-10)', t => {
	const {conversations, timers} = fixture();
	conversations.setDraft('first project');
	const ticket = conversations.beginTurn('a');
	if (!ticket) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	conversations.setDraft('retained draft');
	conversations.snapshot(
		snapshot('a', [{type: 'text', text: 'project-a content'}]),
	);
	conversations.selectProject('project-b');
	conversations.selectThread('a');
	t.is(conversations.getState().draft, '');
	t.deepEqual(conversations.getState().transcript.items, []);
	t.false(
		conversations.snapshot(snapshot('a', [{type: 'text', text: 'foreign'}])),
	);
	conversations.receive(turn([{type: 'text', text: 'foreign live'}]));
	t.is(timers.length, 0);
	conversations.setDraft('project-b draft');
	t.false(
		conversations.finishTurn(ticket, {
			ok: true,
			value: {stopReason: 'end_turn'},
		}),
	);
	t.false(
		conversations.setCancellation('project-a', 'a', {ok: true, value: null}),
	);
	t.is(conversations.getState().draft, 'project-b draft');
	conversations.selectProject('project-a');
	conversations.selectThread('a');
	t.is(conversations.getState().draft, 'retained draft');
	t.is(conversations.getState().transcript.items[0]?.text, 'project-a content');
});

test('live content batches for 16ms without changing a settled row identity (PERF-04, CHAT-05)', t => {
	const {conversations, timers, changes} = fixture();
	t.true(
		conversations.snapshot(
			snapshot('a', [
				{type: 'user', text: 'earlier'},
				{type: 'text', text: 'settled'},
				{type: 'user', text: 'next'},
			]),
		),
	);
	const settled = conversations.getState().transcript.items[1];
	const before = changes.length;
	for (let i = 0; i < 100; i++)
		conversations.receive(turn([{type: 'text', text: `${i},`}]));
	t.is(changes.length, before);
	t.is(timers.length, 1);
	t.is(timers[0].delayMs, 16);
	t.is(conversations.getState().transcript.items.length, 3);
	timers[0].callback();
	t.is(conversations.getState().transcript.items[1], settled);
	t.is(
		conversations.getState().transcript.items[3]?.text,
		Array.from({length: 100}, (_, i) => `${i},`).join(''),
	);
});

test('approval display and closure flush all preceding content immediately and cancel old frame callbacks (CHAT-05, ACP-10)', t => {
	const {conversations, changes, timers} = fixture();
	const request = {
		id: 'request-a',
		title: 'offered action',
		options: [{id: 'deny', name: 'deny', kind: 'reject_once' as const}],
	};
	conversations.receive(turn([{type: 'text', text: 'before approval'}]));
	conversations.receive(turn([{type: 'permission', request}]));
	t.deepEqual(conversations.getState().transcript.permissions, [request]);
	t.is(conversations.getState().transcript.items[0]?.text, 'before approval');
	const first = changes.find(state => state.transcript.permissions.length);
	t.is(first?.transcript.items[0]?.text, 'before approval');
	conversations.receive(turn([{type: 'permission-closed', id: request.id}]));
	t.deepEqual(conversations.getState().transcript.permissions, []);
	const before = changes.length;
	for (const timer of timers) {
		t.true(timer.cancelled);
		timer.callback();
	}
	t.is(changes.length, before);
});

test('replay replaces a flushed prefix without duplicate old chunks and retains the failed-turn notice (CHAT-04, CHAT-05)', t => {
	const {conversations, timers} = fixture();
	conversations.setDraft('failed');
	const ticket = conversations.beginTurn('a');
	if (!ticket) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	conversations.receive(
		turn([
			{type: 'user', text: 'failed'},
			{type: 'text', text: 'old partial'},
		]),
	);
	t.true(
		conversations.finishTurn(ticket, {
			ok: false,
			error: {
				code: 'AGENT_UNAVAILABLE',
				message: 'failed turn',
				retryable: true,
			},
		}),
	);
	conversations.receive(turn([{type: 'text', text: 'obsolete suffix'}]));
	t.true(
		conversations.snapshot(
			snapshot('a', [
				{type: 'user', text: 'earlier'},
				{type: 'text', text: 'history from main'},
			]),
		),
	);
	t.deepEqual(conversations.getState().transcript.items, [
		{kind: 'user', text: 'earlier'},
		{kind: 'agent', text: 'history from main'},
		{kind: 'failure', text: 'failed turn'},
	]);
	for (const timer of timers) timer.callback();
	t.is(conversations.getState().transcript.items.length, 3);
});

test('terminal results flush owned content before the failure notice and preserve the editable next draft (CHAT-05, DATA-10)', t => {
	const {conversations, timers} = fixture();
	conversations.setDraft('sent');
	const ticket = conversations.beginTurn('a');
	if (!ticket) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	conversations.receive(
		turn([
			{type: 'user', text: 'sent'},
			{type: 'text', text: 'partial'},
		]),
	);
	conversations.setDraft('next draft');
	const failed = {
		ok: false as const,
		error: {
			code: 'AGENT_UNAVAILABLE' as const,
			message: 'turn failed',
			retryable: true,
		},
	};
	t.true(conversations.finishTurn(ticket, failed));
	t.deepEqual(
		conversations.getState().transcript.items.map(item => item.kind),
		['user', 'agent', 'failure'],
	);
	t.is(conversations.getState().draft, 'next draft');
	t.true(timers[0].cancelled);
	t.false(conversations.finishTurn(ticket, failed));
	t.is(conversations.getState().transcript.items.length, 3);
});

test('cancelled preparation restores an unsent draft but never overwrites a new draft or resends displayed input (CHAT-06, DATA-10)', t => {
	const {conversations} = fixture();
	const cancelled = {
		ok: true as const,
		value: {stopReason: 'cancelled' as const},
	};
	conversations.setDraft(' original \n draft ');
	const first = conversations.beginTurn('a');
	if (!first) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	t.true(conversations.finishTurn(first, cancelled));
	t.is(conversations.getState().draft, ' original \n draft ');
	t.deepEqual(conversations.getState().transcript.items, []);
	conversations.setDraft('sent');
	const second = conversations.beginTurn('a');
	if (!second) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	conversations.receive(turn([{type: 'user', text: 'sent'}]));
	t.true(conversations.finishTurn(second, cancelled));
	t.is(conversations.getState().draft, '');
	conversations.setDraft('old');
	const third = conversations.beginTurn('a');
	if (!third) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	conversations.setDraft('new draft');
	t.true(conversations.finishTurn(third, cancelled));
	t.is(conversations.getState().draft, 'new draft');
});

test('switch remove and disposal flush or discard only owned queues and refuse every stale completion (CHAT-03, CHAT-14)', t => {
	const {conversations, timers, changes} = fixture();
	conversations.receive(turn([{type: 'text', text: 'before switch'}]));
	conversations.selectThread('b');
	t.deepEqual(conversations.getState().transcript.items, []);
	t.true(timers[0].cancelled);
	conversations.selectThread('a');
	t.is(conversations.getState().transcript.items[0]?.text, 'before switch');
	conversations.setDraft('sent');
	const ticket = conversations.beginTurn('a');
	if (!ticket) {
		t.fail('the selected draft should begin a turn');
		return;
	}
	conversations.receive(turn([{type: 'text', text: 'discarded'}]));
	conversations.remove('a');
	t.is(conversations.getState().activeThreadId, null);
	t.false(
		conversations.finishTurn(ticket, {
			ok: true,
			value: {stopReason: 'end_turn'},
		}),
	);
	t.false(
		conversations.snapshot(snapshot('a', [{type: 'text', text: 'removed'}])),
	);
	conversations.receive(turn([{type: 'text', text: 'removed live'}]));
	const before = changes.length;
	conversations.dispose();
	conversations.selectProject('project-b');
	conversations.selectThread('a');
	conversations.setDraft('too late');
	t.false(conversations.snapshot(snapshot('a', [], 'project-b')));
	for (const timer of timers) timer.callback();
	t.is(changes.length, before);
	t.is(conversations.getState().projectId, null);
	t.deepEqual(conversations.getState().transcript.items, []);
});
