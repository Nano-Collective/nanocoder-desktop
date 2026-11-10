import test from 'ava';
import {settledSample} from '@/main/settled-sample';

const waiter = () => {
	const waits: number[] = [];
	return {waits, wait: async (ms: number) => void waits.push(ms)};
};

test('PERF-09 a figure is taken once two samples in a row agree, and not before', async t => {
	const readings = [900, 700, 520, 505, 503];
	const {waits, wait} = waiter();
	const value = await settledSample({
		sample: () => readings.shift() ?? 0,
		wait,
		intervalMs: 500,
		tolerance: 0.05,
		maxSamples: 20,
	});
	t.is(value, 505);
	t.deepEqual(waits, [500, 500, 500]);
});

test('PERF-09 a figure that never settles is the last sample after the sample limit, not a hang', async t => {
	let next = 100;
	const {waits, wait} = waiter();
	const value = await settledSample({
		sample: () => (next *= 2),
		wait,
		intervalMs: 500,
		tolerance: 0.05,
		maxSamples: 4,
	});
	t.is(value, 1600);
	t.is(waits.length, 3);
});

test('PERF-09 a first sample that is zero never counts as settled against a second', async t => {
	const readings = [0, 0, 400, 402];
	const {wait} = waiter();
	t.is(
		await settledSample({
			sample: () => readings.shift() ?? 0,
			wait,
			intervalMs: 1,
			tolerance: 0.05,
			maxSamples: 10,
		}),
		402,
	);
});
