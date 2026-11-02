import test from 'ava';
import {diffKey, parseDiff, selectLines} from '@/renderer/diff-parse';

const diff = [
	'diff --git a/a.ts b/a.ts',
	'index 111..222 100644',
	'--- a/a.ts',
	'+++ b/a.ts',
	'@@ -1,4 +1,5 @@',
	' one',
	'-two',
	'+TWO',
	'+TWO AND A HALF',
	' three',
	'@@ -20,2 +21,2 @@ function x()',
	' keep',
	'-gone',
	'+here',
	'\\ No newline at end of file',
	'',
].join('\n');

test('GIT-04 headers carry no line numbers and cannot be selected', t => {
	const rows = parseDiff(diff);
	t.deepEqual(
		rows
			.slice(0, 5)
			.map(row => [row.kind, row.selectable, row.oldLine, row.newLine]),
		[
			['file', false, null, null],
			['file', false, null, null],
			['file', false, null, null],
			['file', false, null, null],
			['hunk', false, null, null],
		],
	);
});

test('GIT-04 each hunk restarts the old and new line counters', t => {
	const rows = parseDiff(diff);
	const numbers = rows
		.filter(row => row.selectable)
		.map(row => [row.kind, row.oldLine, row.newLine, row.text]);
	t.deepEqual(numbers, [
		['context', 1, 1, 'one'],
		['remove', 2, null, 'two'],
		['add', null, 2, 'TWO'],
		['add', null, 3, 'TWO AND A HALF'],
		['context', 3, 4, 'three'],
		['context', 20, 21, 'keep'],
		['remove', 21, null, 'gone'],
		['add', null, 22, 'here'],
	]);
	t.is(rows.at(-1)?.kind, 'note');
	t.false(rows.at(-1)?.selectable);
});

test('GIT-04 a new file diff numbers every added line from one', t => {
	const rows = parseDiff(
		'--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n',
	);
	t.deepEqual(
		rows.filter(row => row.selectable).map(row => row.newLine),
		[1, 2],
	);
});

test('GIT-04 a second file in one diff resets to its own headers', t => {
	const rows = parseDiff(
		`${diff}diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n`,
	);
	const tail = rows.slice(-6);
	t.is(tail[0].kind, 'file');
	t.false(tail[1].selectable);
	t.deepEqual(
		tail
			.filter(row => row.selectable)
			.map(row => [row.kind, row.oldLine, row.newLine]),
		[
			['remove', 1, null],
			['add', null, 1],
		],
	);
});

test('GIT-07 a selection spans the rows between two clicks and reports line numbers and text', t => {
	const rows = parseDiff(diff);
	const index = (kind: string, text: string) =>
		rows.findIndex(row => row.kind === kind && row.text === text);
	const selected = selectLines(
		rows,
		index('add', 'TWO'),
		index('context', 'three'),
	);
	t.deepEqual(selected, {
		startLine: 2,
		endLine: 4,
		excerpt: '+TWO\n+TWO AND A HALF\n three',
	});
	t.deepEqual(
		selectLines(rows, index('add', 'TWO AND A HALF'), index('add', 'TWO')),
		{startLine: 2, endLine: 3, excerpt: '+TWO\n+TWO AND A HALF'},
	);
	t.deepEqual(
		selectLines(rows, index('remove', 'two'), index('remove', 'two')),
		{
			startLine: 2,
			endLine: 2,
			excerpt: '-two',
		},
	);
});

test('GIT-07 a selection of headers alone is no selection, and headers inside a range are skipped', t => {
	const rows = parseDiff(diff);
	t.is(selectLines(rows, 0, 3), null);
	t.is(selectLines(rows, 4, 4), null);
	const across = selectLines(rows, 7, 12);
	t.truthy(across);
	t.false(across?.excerpt.includes('@@'));
	t.deepEqual(parseDiff(''), []);
});

test('GIT-07 arrow keys move over lines of change and context, never headers', t => {
	const rows = parseDiff(diff);
	const lines = rows.flatMap((row, index) => (row.selectable ? [index] : []));
	t.deepEqual(diffKey(rows, null, 'ArrowDown', false), {
		anchor: lines[0],
		cursor: lines[0],
	});
	t.deepEqual(
		diffKey(rows, {anchor: lines[0], cursor: lines[0]}, 'ArrowDown', false),
		{
			anchor: lines[1],
			cursor: lines[1],
		},
	);
	// From the last line of the first hunk, the next is across the hunk header.
	const endOfFirst = lines[4];
	t.deepEqual(
		diffKey(rows, {anchor: endOfFirst, cursor: endOfFirst}, 'ArrowDown', false),
		{
			anchor: lines[5],
			cursor: lines[5],
		},
	);
	t.deepEqual(
		diffKey(rows, {anchor: lines[5], cursor: lines[5]}, 'ArrowUp', false),
		{
			anchor: lines[4],
			cursor: lines[4],
		},
	);
	t.deepEqual(
		diffKey(rows, {anchor: lines[0], cursor: lines[0]}, 'ArrowUp', false),
		{
			anchor: lines[0],
			cursor: lines[0],
		},
	);
	const last = lines.at(-1) as number;
	t.deepEqual(diffKey(rows, {anchor: last, cursor: last}, 'ArrowDown', false), {
		anchor: last,
		cursor: last,
	});
});

test('GIT-07 Shift extends a range from its anchor in either direction', t => {
	const rows = parseDiff(diff);
	const lines = rows.flatMap((row, index) => (row.selectable ? [index] : []));
	let state = diffKey(rows, null, 'ArrowDown', false);
	state = diffKey(rows, state, 'ArrowDown', true);
	state = diffKey(rows, state, 'ArrowDown', true);
	t.deepEqual(state, {anchor: lines[0], cursor: lines[2]});
	state = diffKey(rows, state, 'ArrowUp', true);
	t.deepEqual(state, {anchor: lines[0], cursor: lines[1]});
	state = diffKey(rows, state, 'End', true);
	t.deepEqual(state, {anchor: lines[0], cursor: lines.at(-1)});
	state = diffKey(rows, state, 'Home', false);
	t.deepEqual(state, {anchor: lines[0], cursor: lines[0]});
	state = diffKey(rows, {anchor: lines[3], cursor: lines[3]}, ' ', false);
	t.deepEqual(state, {anchor: lines[3], cursor: lines[3]});
	t.deepEqual(diffKey(rows, null, 'Enter', false), {
		anchor: lines[0],
		cursor: lines[0],
	});
	t.is(diffKey(rows, state, 'x', false), null);
	t.is(diffKey(parseDiff('--- a\n+++ b\n'), null, 'ArrowDown', false), null);
});
