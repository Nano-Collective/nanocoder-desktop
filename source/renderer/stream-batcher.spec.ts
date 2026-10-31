import test from 'ava';
import {
	createStreamBatcher,
	type StreamBatchClock,
} from '@/renderer/stream-batcher';
import type {TurnEvent} from '@/shared/ipc';

function fixture() {
	const scheduled: {
		callback: () => void;
		delayMs: number;
		cancelled: boolean;
	}[] = [];
	const delivered: {
		threadId: string;
		events: readonly TurnEvent[];
		tag?: string;
	}[] = [];
	const clock: StreamBatchClock = {
		schedule(callback, delayMs) {
			const task = {callback, delayMs, cancelled: false};
			scheduled.push(task);
			return () => {
				task.cancelled = true;
			};
		},
	};
	const batcher = createStreamBatcher(
		(threadId, events, tag) =>
			delivered.push(
				tag === undefined ? {threadId, events} : {threadId, events, tag},
			),
		clock,
	);
	return {batcher, scheduled, delivered};
}

test('100 updates schedule one cancellable 16ms batch, preserving content order (PERF-04)', t => {
	const {batcher, scheduled, delivered} = fixture();
	for (let index = 0; index < 100; index++)
		batcher.enqueue('thread', [{type: 'text', text: `${index},`}]);
	t.deepEqual(delivered, []);
	t.is(scheduled.length, 1);
	t.is(scheduled[0].delayMs, 16);
	scheduled[0].callback();
	t.deepEqual(delivered, [
		{
			threadId: 'thread',
			events: Array.from({length: 100}, (_, index) => ({
				type: 'text',
				text: `${index},`,
			})),
		},
	]);
});

test('interleaved thread batches retain receive order and never mix threads (CHAT-05)', t => {
	const {batcher, delivered} = fixture();
	batcher.enqueue('a', [{type: 'text', text: 'one'}]);
	batcher.enqueue('b', [{type: 'text', text: 'two'}]);
	batcher.enqueue('a', [{type: 'text', text: 'three'}]);
	batcher.flush();
	t.deepEqual(
		delivered.map(({threadId, events}) => [threadId, events]),
		[
			['a', [{type: 'text', text: 'one'}]],
			['b', [{type: 'text', text: 'two'}]],
			['a', [{type: 'text', text: 'three'}]],
		],
	);
});

test('flush delivers before terminal or approval state and cancels the old callback (CHAT-05)', t => {
	const {batcher, scheduled, delivered} = fixture();
	batcher.enqueue('thread', [{type: 'text', text: 'before approval'}]);
	batcher.flush('thread');
	t.is(delivered.length, 1);
	t.true(scheduled[0].cancelled);
	scheduled[0].callback();
	t.is(delivered.length, 1);
});

test('remove and dispose cancel stale callbacks and discard only the owned queues (CHAT-05)', t => {
	const {batcher, scheduled, delivered} = fixture();
	batcher.enqueue('removed', [{type: 'text', text: 'stale'}]);
	batcher.enqueue('retained', [{type: 'text', text: 'current'}]);
	batcher.remove('removed');
	batcher.flush();
	t.deepEqual(delivered, [
		{threadId: 'retained', events: [{type: 'text', text: 'current'}]},
	]);
	batcher.enqueue('retained', [{type: 'text', text: 'discarded'}]);
	batcher.dispose();
	batcher.enqueue('retained', [{type: 'text', text: 'too late'}]);
	for (const task of scheduled) {
		t.true(task.cancelled);
		task.callback();
	}
	t.is(delivered.length, 1);
});

test('tagged batches never merge across tags and deliver their tag in receive order', t => {
	const {batcher, scheduled, delivered} = fixture();
	batcher.enqueue('thread', [{type: 'text', text: 'one'}], 'replay');
	batcher.enqueue('thread', [{type: 'text', text: 'two'}], 'replay');
	batcher.enqueue('thread', [{type: 'text', text: 'three'}], 'live');
	batcher.enqueue('thread', [{type: 'text', text: 'four'}]);
	batcher.enqueue('thread', [{type: 'text', text: 'five'}], 'live');
	t.is(scheduled.length, 1);
	scheduled[0].callback();
	t.deepEqual(delivered, [
		{
			threadId: 'thread',
			tag: 'replay',
			events: [
				{type: 'text', text: 'one'},
				{type: 'text', text: 'two'},
			],
		},
		{threadId: 'thread', tag: 'live', events: [{type: 'text', text: 'three'}]},
		{threadId: 'thread', events: [{type: 'text', text: 'four'}]},
		{threadId: 'thread', tag: 'live', events: [{type: 'text', text: 'five'}]},
	]);
});
