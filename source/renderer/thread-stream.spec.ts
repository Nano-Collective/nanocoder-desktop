import test from 'ava';
import {createThreadStream} from '@/renderer/thread-stream';
import type {ProjectEvent, ThreadSnapshot} from '@/shared/ipc';

type ThreadTurn = Extract<ProjectEvent, {type: 'turn'}>;
const snapshot = (
	sequence: number,
	projectId = 'project-a',
): ThreadSnapshot => ({
	thread: {
		id: 'thread-a',
		projectId,
		nanocoderSessionId: 'saved-session',
		title: 'fixture thread',
		archiveState: 'active',
		runState: 'ready',
		lastActivityAt: '2026-10-30T14:00:00.000Z',
		sessionCwd: '/fixture',
		mode: 'normal',
		viewOnlyReason: null,
	},
	sequence,
	replaying: false,
	events: [{type: 'text', text: `prefix ${sequence}`}],
});
const turn = (sequence: number, projectId = 'project-a'): ThreadTurn => ({
	type: 'turn',
	projectId,
	threadId: 'thread-a',
	sequence,
	events: [{type: 'text', text: `delta ${sequence}`}],
});
function fixture() {
	const delivered: Array<ThreadSnapshot | ThreadTurn> = [];
	const gaps: Array<{threadId: string; token: number}> = [];
	const stream = createThreadStream({
		onSnapshot: value => delivered.push(value),
		onTurn: value => delivered.push(value),
		onGap: (threadId, token) => gaps.push({threadId, token}),
	});
	stream.selectProject('project-a');
	return {stream, delivered, gaps};
}

test('thread stream routes only newer contiguous events in its owning project (CHAT-04)', t => {
	const {stream, delivered, gaps} = fixture();
	const prefix = snapshot(5);
	t.true(stream.replace(stream.begin('thread-a'), prefix));
	stream.receive(turn(6));
	stream.receive(turn(6));
	stream.receive(turn(4));
	stream.receive(turn(100, 'project-b'));
	t.deepEqual(delivered, [prefix, turn(6)]);
	t.deepEqual(gaps, []);
});

test('an in-flight snapshot replaces the prefix before delivering newer buffered live events (CHAT-04)', t => {
	const {stream, delivered} = fixture();
	const token = stream.begin('thread-a');
	stream.receive(turn(2));
	stream.receive(turn(2));
	stream.receive(turn(3));
	t.deepEqual(delivered, []);
	t.true(stream.replace(token, snapshot(1)));
	t.deepEqual(delivered, [snapshot(1), turn(2), turn(3)]);
});

test('a sequence gap requests a main snapshot instead of inventing missing content (CHAT-04)', t => {
	const {stream, delivered, gaps} = fixture();
	stream.replace(stream.begin('thread-a'), snapshot(5));
	stream.receive(turn(7));
	t.is(gaps.length, 1);
	t.is(gaps[0]?.threadId, 'thread-a');
	t.deepEqual(delivered, [snapshot(5)]);
	t.true(stream.needsSnapshot('thread-a'));
	t.true(stream.replace(gaps[0].token, snapshot(7)));
	stream.receive(turn(6));
	t.deepEqual(delivered, [snapshot(5), snapshot(7)]);
	t.false(stream.needsSnapshot('thread-a'));
});

test('removed switched and superseded snapshot results cannot replace current history (CHAT-04, CHAT-14)', t => {
	const {stream, delivered} = fixture();
	const old = stream.begin('thread-a');
	const current = stream.begin('thread-a');
	t.false(stream.replace(old, snapshot(1)));
	t.true(stream.replace(current, snapshot(2)));
	const removed = stream.begin('thread-a');
	stream.remove('thread-a');
	t.false(stream.replace(removed, snapshot(3)));
	const switched = stream.begin('thread-a');
	stream.selectProject('project-b');
	t.false(stream.replace(switched, snapshot(4)));
	t.deepEqual(delivered, [snapshot(2)]);
});

test('a stale snapshot preserves the current prefix and only a later live event requests another read (CHAT-04)', t => {
	const {stream, delivered, gaps} = fixture();
	stream.replace(stream.begin('thread-a'), snapshot(5));
	const token = stream.begin('thread-a');
	stream.receive(turn(7));
	t.false(stream.replace(token, snapshot(4)));
	t.deepEqual(delivered, [snapshot(5)]);
	t.deepEqual(gaps, []);
	stream.receive(turn(8));
	t.is(gaps.length, 1);
	t.true(stream.replace(gaps[0].token, snapshot(8)));
	t.deepEqual(delivered, [snapshot(5), snapshot(8)]);
});

test('a snapshot with a remaining sequence gap never appends across it or starts an automatic retry loop (CHAT-04)', t => {
	const {stream, delivered, gaps} = fixture();
	stream.replace(stream.begin('thread-a'), snapshot(2));
	const token = stream.begin('thread-a');
	stream.receive(turn(5));
	t.false(stream.replace(token, snapshot(3)));
	t.deepEqual(delivered, [snapshot(2), snapshot(3)]);
	t.deepEqual(gaps, []);
	stream.receive(turn(6));
	t.is(gaps.length, 1);
	t.true(stream.replace(gaps[0].token, snapshot(6)));
	t.deepEqual(delivered, [snapshot(2), snapshot(3), snapshot(6)]);
});
