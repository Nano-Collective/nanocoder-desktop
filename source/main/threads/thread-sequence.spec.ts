import test from 'ava';
import {createThreadSequence} from '@/main/threads/thread-sequence';

test('SUB-05 exactly 10000 observations reserve one existing batch sequence with distinct bounded slots', t => {
	const allocator = createThreadSequence();
	const batches = allocator.reserve(10000);
	t.deepEqual(batches, [
		{sequence: 1, count: 10000, firstSlot: 10001, highWaterMark: 20001},
	]);
	t.is(allocator.current(), 1);
	const next = allocator.reserve(1);
	t.is(next[0].sequence, 2);
	t.true(next[0].firstSlot > batches[0].highWaterMark);
});

test('SUB-05 10001 observations split through the same allocator without overlapping or losing an event', t => {
	const allocator = createThreadSequence({sequence: 6});
	const batches = allocator.reserve(10001);
	t.deepEqual(
		batches.map(batch => [batch.sequence, batch.count]),
		[
			[7, 10000],
			[8, 1],
		],
	);
	t.is(
		batches.reduce((total, batch) => total + batch.count, 0),
		10001,
	);
	const slots = batches.flatMap(batch =>
		Array.from({length: batch.count}, (_, index) => batch.firstSlot + index),
	);
	t.is(new Set(slots).size, 10001);
	t.true(batches[1].firstSlot > batches[0].highWaterMark);
	t.true(slots.every(Number.isSafeInteger));
	t.is(allocator.current(), 8);
});

test('SUB-05 restored batch bases allocate strictly above every persisted observation and replay high-water slot', t => {
	for (const highWaterMark of [0, 10001, 10002, 20001, 20002, 30002, 40004]) {
		const allocator = createThreadSequence({highWaterMark});
		const batch = allocator.reserve(1)[0];
		t.true(batch.firstSlot > highWaterMark);
		t.true(batch.highWaterMark > highWaterMark);
		t.is(batch.sequence, Math.floor(highWaterMark / 10001) + 1);
	}
	const current = createThreadSequence({sequence: 20, highWaterMark: 20001});
	t.is(current.reserve(0)[0].sequence, 21);
});

test('SUB-05 slot overflow refuses the whole reservation without advancing its batch sequence', t => {
	const limit = Math.floor(Number.MAX_SAFE_INTEGER / 10001);
	const allocator = createThreadSequence({sequence: limit - 1});
	t.throws(() => allocator.reserve(10001), {
		code: 'UNAVAILABLE',
		message: 'The thread sequence limit was reached',
	});
	t.is(allocator.current(), limit - 1);
	const last = allocator.reserve(0)[0];
	t.true(Number.isSafeInteger(last.highWaterMark));
	t.is(last.sequence, limit);
	t.throws(() => allocator.reserve(1), {code: 'UNAVAILABLE'});
	t.is(allocator.current(), limit);
});

for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
	test(`SUB-05 malformed batch counter ${String(invalid)} never creates or advances an allocator`, t => {
		t.throws(() => createThreadSequence({sequence: invalid}), {
			code: 'VALIDATION',
		});
		t.throws(() => createThreadSequence({highWaterMark: invalid}), {
			code: 'VALIDATION',
		});
		const allocator = createThreadSequence();
		t.throws(() => allocator.reserve(invalid), {code: 'VALIDATION'});
		t.is(allocator.current(), 0);
	});
}
