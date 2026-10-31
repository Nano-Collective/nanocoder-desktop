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

const firstEpoch = 'b60c4d2a-f55e-4e8f-b397-84f65adc1aac';
const secondEpoch = '103f1840-443e-4df6-9735-1b89bbac0d02';
const boundary = (
	sequence: number,
	epoch: string,
	phase: 'begin' | 'complete' | 'failed',
): ThreadTurn =>
	Object.assign(turn(sequence), {events: [], replay: {epoch, phase}});

test('CHAT-08 replay completion requests only a snapshot and never appends an uncommitted prefix', t => {
	const {stream, delivered, gaps} = fixture();
	stream.replace(stream.begin('thread-a'), snapshot(0));
	stream.receive(boundary(1, firstEpoch, 'begin'));
	stream.receive(boundary(2, firstEpoch, 'complete'));
	t.is(gaps.length, 1);
	t.deepEqual(delivered, [snapshot(0), boundary(1, firstEpoch, 'begin')]);
	t.true(
		stream.replace(
			gaps[0].token,
			Object.assign(snapshot(2), {replayEpoch: firstEpoch}),
		),
	);
});

test('CHAT-08 a stale in-progress snapshot after completion can request one fresh prefix but never loops', t => {
	const {stream, gaps} = fixture();
	stream.replace(stream.begin('thread-a'), snapshot(0));
	const token = stream.begin('thread-a');
	stream.receive(boundary(1, firstEpoch, 'begin'));
	stream.receive(boundary(2, firstEpoch, 'complete'));
	const prefix = Object.assign(snapshot(1), {
		replayEpoch: firstEpoch,
		replaying: true,
	});
	t.false(stream.replace(token, prefix));
	t.is(gaps.length, 1);
	t.false(stream.replace(gaps[0].token, prefix));
	t.is(gaps.length, 1);
});

test('CHAT-08 a same-epoch prefix older than its complete marker cannot enable the composer', t => {
	const phases: string[] = [];
	const gaps: number[] = [];
	const snapshots: ThreadSnapshot[] = [];
	const stream = createThreadStream({
		onReplay: (_threadId, phase) => phases.push(phase),
		onSnapshot: value => snapshots.push(value),
		onTurn() {},
		onGap: (_threadId, token) => gaps.push(token),
	});
	stream.selectProject('project-a');
	stream.replace(stream.begin('thread-a'), snapshot(0));
	stream.receive(boundary(1, firstEpoch, 'begin'));
	stream.receive(boundary(3, firstEpoch, 'complete'));
	t.false(
		stream.replace(
			gaps[0],
			Object.assign(snapshot(1), {replayEpoch: firstEpoch}),
		),
	);
	t.false(phases.includes('complete'));
	t.deepEqual(snapshots, [snapshot(0)]);
});

test('CHAT-08 reselecting the same project during prefix flush cannot deliver the retired buffered live events', t => {
	const delivered: ThreadTurn[] = [];
	let reset = false;
	const stream = createThreadStream({
		onSnapshot: value => {
			if (value.sequence === 1 && !reset) {
				reset = true;
				stream.selectProject('project-a');
			}
		},
		onTurn: value => delivered.push(value),
		onGap() {},
	});
	stream.selectProject('project-a');
	const token = stream.begin('thread-a');
	stream.receive(turn(2));
	t.false(stream.replace(token, snapshot(1)));
	t.deepEqual(delivered, []);
	t.true(stream.replace(stream.begin('thread-a'), snapshot(1)));
	t.deepEqual(delivered, []);
});

test('CHAT-08 failed older epochs cannot replace a retried epoch, even with a larger stale snapshot sequence', t => {
	const {stream, delivered} = fixture();
	stream.replace(stream.begin('thread-a'), snapshot(0));
	stream.receive(boundary(1, firstEpoch, 'begin'));
	stream.receive(boundary(2, firstEpoch, 'failed'));
	stream.receive(boundary(3, secondEpoch, 'begin'));
	const before = structuredClone(delivered);
	t.false(
		stream.replace(
			stream.begin('thread-a'),
			Object.assign(snapshot(100), {replayEpoch: firstEpoch}),
		),
	);
	t.deepEqual(delivered, before);
});

for (const replay of [
	{epoch: 'not-an-epoch', phase: 'begin'},
	{epoch: firstEpoch, phase: 'unlisted'},
	{epoch: firstEpoch, phase: 'complete', authority: true},
]) {
	test(`CHAT-08 malformed replay boundary is refused without advancing the stream: ${JSON.stringify(replay)}`, t => {
		const {stream, delivered, gaps} = fixture();
		stream.replace(stream.begin('thread-a'), snapshot(0));
		stream.receive(Object.assign(turn(1), {events: [], replay}));
		t.deepEqual(delivered, [snapshot(0)]);
		t.deepEqual(gaps, []);
		stream.receive(turn(1));
		t.deepEqual(delivered, [snapshot(0), turn(1)]);
	});
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
