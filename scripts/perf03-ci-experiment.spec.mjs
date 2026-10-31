import test from 'ava';
import {
	budgetFailures,
	responseWindows,
	variantSource,
} from './perf03-ci-experiment.mjs';

test('the B experiment changes exactly one variant literal', t => {
	const source = "export function experimentVariant() {\n\treturn 'A';\n}\n";
	t.is(variantSource(source, 'A'), source);
	t.is(variantSource(source, 'B'), source.replace("'A'", "'B'"));
	t.throws(() => variantSource('missing', 'B'));
	t.throws(() => variantSource(source + source, 'B'));
	t.throws(() => variantSource(source, 'invalid'));
});

test('original PERF-03 budgets remain strict, including the observed 100.1ms failure', t => {
	const metrics = {
		messages: 200,
		prefixMs: 2000,
		usableMs: 2000,
		inputMs: 100,
		scrollMs: 100,
		frameMs: 100,
		eventLoopMs: 100,
	};
	t.deepEqual(budgetFailures(metrics), []);
	for (const key of ['inputMs', 'scrollMs', 'frameMs', 'eventLoopMs'])
		t.deepEqual(budgetFailures({...metrics, [key]: 100.1}), [key]);
	t.deepEqual(budgetFailures({...metrics, usableMs: 2000.1}), ['usableMs']);
	t.deepEqual(budgetFailures(null), ['missing metrics']);
	t.deepEqual(budgetFailures({...metrics, inputMs: Number.NaN}), [
		'invalid metrics',
	]);
});

test('correlation includes overlapping long tasks and only in-window read/commit timestamps', t => {
	const events = [
		{kind: 'input-start', at: 100},
		{kind: 'longtask', at: 90, duration: 50},
		{kind: 'recents-read-resolved', at: 105, readId: 3},
		{kind: 'recents-react-commit', at: 115, readId: 3},
		{kind: 'input-end', at: 120},
		{kind: 'recents-react-commit', at: 121, readId: 4},
		{kind: 'longtask', at: 120, duration: 80},
	];
	t.deepEqual(responseWindows({events}), [
		{
			metric: 'input',
			start: 100,
			end: 120,
			overlaps: events.slice(1, 4),
		},
	]);
});
