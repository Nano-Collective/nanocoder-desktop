import test from 'ava';
import {
	BUDGETS,
	formatReport,
	largestDirectory,
	largestFileUnder,
	parseArgs,
	verdict,
} from './perf.mjs';

test('PERF-05 to PERF-08 budgets are the ones in the testing strategy', t => {
	t.deepEqual(BUDGETS, {
		'PERF-05': 300,
		'PERF-06': 500,
		'PERF-07': 5000,
		'PERF-08': 1000,
	});
});

test('a measurement passes at its budget and fails above it', t => {
	t.deepEqual(verdict('PERF-05', 300), {ok: true, budget: 300});
	t.deepEqual(verdict('PERF-05', 300.5), {ok: false, budget: 300});
	t.deepEqual(verdict('PERF-07', 12), {ok: true, budget: 5000});
	t.throws(() => verdict('PERF-99', 1), {message: /No budget/});
});

test('the busiest directory counts files and sub-directories directly inside it, root included', t => {
	const result = largestDirectory([
		'README.md',
		'src/a.ts',
		'src/b.ts',
		'src/deep/c.ts',
		'src/deep/d.ts',
		'src/deep/e.ts',
		'src/deep/f.ts',
		'docs/x.md',
	]);
	t.deepEqual(result, {directory: 'src/deep', entries: 4});
	t.deepEqual(largestDirectory(['a', 'b', 'c/d']), {directory: '', entries: 3});
	t.deepEqual(largestDirectory([]), {directory: '', entries: 0});
});

test('the largest preview candidate is the biggest file under the limit, never a larger one', t => {
	const files = [
		{path: 'small.txt', size: 10},
		{path: 'near.txt', size: 1_048_576},
		{path: 'over.txt', size: 1_048_577},
		{path: 'empty.txt', size: 0},
	];
	t.deepEqual(largestFileUnder(files, 1_048_576), {
		path: 'near.txt',
		size: 1_048_576,
	});
	t.is(largestFileUnder([{path: 'big', size: 9}], 5), undefined);
	t.is(largestFileUnder([], 5), undefined);
	t.is(largestFileUnder([{path: 'empty', size: 0}], 5), undefined);
});

test('arguments: a repository, a run count, a report file, resume and a no-fail switch, refusing the rest', t => {
	t.deepEqual(parseArgs([]), {
		repo: undefined,
		runs: 5,
		json: undefined,
		resume: false,
		noFail: false,
	});
	t.deepEqual(
		parseArgs([
			'--repo',
			'/r',
			'--runs',
			'3',
			'--json',
			'/o.json',
			'--resume',
			'--no-fail',
		]),
		{repo: '/r', runs: 3, json: '/o.json', resume: true, noFail: true},
	);
	t.throws(() => parseArgs(['--runs', '0']), {message: /--runs/});
	t.throws(() => parseArgs(['--runs', 'many']), {message: /--runs/});
	t.throws(() => parseArgs(['--repo']), {message: /--repo/});
	t.throws(() => parseArgs(['--unknown']), {message: /Unknown/});
});

test('the report names each measurement with its budget, verdict and what was skipped', t => {
	const text = formatReport({
		machine: {
			platform: 'darwin',
			cpu: 'Fixture CPU',
			cores: 8,
			memoryGb: 16,
			node: 'v22.0.0',
			git: '2.50.0',
		},
		repository: {
			kind: 'real',
			files: 120_000,
			directory: 'src',
			directoryEntries: 2_400,
		},
		runs: 5,
		measurements: [
			{
				id: 'PERF-05',
				what: 'list a directory',
				ms: {min: 10, median: 12, max: 30},
				detail: '2,000 of 2,400 entries',
			},
			{
				id: 'PERF-07',
				what: 'git status',
				ms: {min: 900, median: 6000, max: 7000},
				detail: '120,000 tracked files',
			},
			{
				id: 'PERF-08',
				what: 'diff of one file',
				skipped: 'the repository has no modified file',
			},
			{
				id: 'RESUME',
				what: 'resume a saved session',
				ms: {min: 30, median: 38, max: 41},
			},
			{
				id: 'PERF-02',
				what: 'open the project',
				ms: {min: 300, median: 320, max: 337},
				detail: 'investigate over 5000 ms',
			},
		],
	});
	t.regex(
		text,
		/\| PERF-05 \| list a directory \| 12 ms \(10 to 30\) \| 300 ms \| within budget/,
	);
	t.regex(
		text,
		/\| PERF-07 \| git status \| 6000 ms \(900 to 7000\) \| 5000 ms \| OVER BUDGET/,
	);
	t.regex(
		text,
		/\| PERF-08 \| diff of one file \| not measured \| 1000 ms \| the repository has no modified file/,
	);
	t.regex(
		text,
		/\| RESUME \| resume a saved session \| 38 ms \(30 to 41\) \| recorded \| recorded \|/,
	);
	t.regex(
		text,
		/\| PERF-02 \| open the project \| 320 ms \(300 to 337\) \| recorded \| investigate over 5000 ms \|/,
	);
	t.regex(
		text,
		/\| RESUME \| resume a saved session \| 38 ms \(30 to 41\) \| recorded \| recorded \|/,
	);
	t.regex(
		text,
		/\| PERF-02 \| open the project \| 320 ms \(300 to 337\) \| recorded \| investigate over 5000 ms \|/,
	);
	t.regex(text, /120,000 tracked files/);
	t.regex(text, /Fixture CPU/);
	t.notRegex(text, /—/);
});
