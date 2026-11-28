import test from 'ava';
import {
	type DiffMatch,
	findDiffMatches,
	groupDiffMatches,
	sliceRowHighlights,
} from '@/renderer/diff-find';
import {type DiffRow, parseDiff} from '@/renderer/diff-parse';
import {MAX_DIFF_ROWS} from '@/renderer/diff-virtual';

function row(
	text: string,
	kind: DiffRow['kind'] = 'context',
	oldLine: number | null = null,
	newLine: number | null = null,
): DiffRow {
	return {
		kind,
		text,
		oldLine,
		newLine,
		selectable: kind === 'add' || kind === 'remove' || kind === 'context',
	};
}

function hit(id: string, start: number, end: number): DiffMatch {
	return {
		id,
		target: {rowIndex: 0, oldLine: null, newLine: null, kind: 'context'},
		start,
		end,
	};
}

test('a query finds matches in every kind of row, in row order', t => {
	const rows = [
		row('diff --git a/api.ts b/api.ts', 'file'),
		row('@@ -1,2 +1,2 @@ api()', 'hunk'),
		row('const api = 1;', 'remove', 3, null),
		row('const api = 2;', 'add', null, 3),
		row('api.run();', 'context', 4, 4),
	];
	const result = findDiffMatches(rows, 'api');
	t.deepEqual(
		result.matches.map(match => match.id),
		['diff:0:0', 'diff:0:1', 'diff:1:0', 'diff:2:0', 'diff:3:0', 'diff:4:0'],
	);
	t.deepEqual(result.matches[0], {
		id: 'diff:0:0',
		target: {rowIndex: 0, oldLine: null, newLine: null, kind: 'file'},
		start: 13,
		end: 16,
	});
	t.deepEqual(result.matches[3], {
		id: 'diff:2:0',
		target: {rowIndex: 2, oldLine: 3, newLine: null, kind: 'remove'},
		start: 6,
		end: 9,
	});
	t.deepEqual(result.matches[4].target, {
		rowIndex: 3,
		oldLine: null,
		newLine: 3,
		kind: 'add',
	});
	t.false(result.capped);
	t.is(result.searchedRows, 5);
	t.is(result.scopeLabel, 'open diff');
});

test('a parsed diff keeps the line numbers on each match', t => {
	const diff = [
		'diff --git a/src/api.ts b/src/api.ts',
		'--- a/src/api.ts',
		'+++ b/src/api.ts',
		'@@ -1,2 +1,2 @@',
		'-const api = 1;',
		'+const api = 2;',
		' api.run();',
	].join('\n');
	const matches = findDiffMatches(parseDiff(diff), 'api').matches;
	t.is(matches.length, 7);
	t.deepEqual(matches.find(match => match.id === 'diff:4:0')?.target, {
		rowIndex: 4,
		oldLine: 1,
		newLine: null,
		kind: 'remove',
	});
	t.deepEqual(matches.find(match => match.id === 'diff:6:0')?.target, {
		rowIndex: 6,
		oldLine: 2,
		newLine: 2,
		kind: 'context',
	});
});

test('a query is literal and ignores case, and an empty query finds nothing', t => {
	const rows = [row('Value = a.b'), row('value = axb')];
	t.deepEqual(
		findDiffMatches(rows, 'VALUE').matches.map(match => match.id),
		['diff:0:0', 'diff:1:0'],
	);
	t.deepEqual(
		findDiffMatches(rows, 'a.b').matches.map(match => match.id),
		['diff:0:0'],
	);
	t.deepEqual(findDiffMatches(rows, '').matches, []);
});

test('matches inside one row are not capped', t => {
	const matches = findDiffMatches([row('api '.repeat(3000))], 'api').matches;
	t.is(matches.length, 3000);
	t.is(matches[2999].id, 'diff:0:2999');
});

test('only the rows the panel shows are searched, and the scope says so', t => {
	const long = Array.from({length: MAX_DIFF_ROWS + 1}, (_, index) =>
		row(index === MAX_DIFF_ROWS ? 'api past the cap' : 'plain'),
	);
	const capped = findDiffMatches(long, 'api');
	t.deepEqual(capped.matches, []);
	t.true(capped.capped);
	t.is(capped.searchedRows, MAX_DIFF_ROWS);
	t.is(capped.scopeLabel, 'first 5,000 diff rows');

	const exact = Array.from({length: MAX_DIFF_ROWS}, (_, index) =>
		row(index === MAX_DIFF_ROWS - 1 ? 'api on the last row' : 'plain'),
	);
	const full = findDiffMatches(exact, 'api');
	t.deepEqual(
		full.matches.map(match => match.id),
		[`diff:${MAX_DIFF_ROWS - 1}:0`],
	);
	t.false(full.capped);
	t.is(full.scopeLabel, 'open diff');
});

test('matches are grouped by their row', t => {
	const matches = findDiffMatches(
		[row('api api'), row('none'), row('api')],
		'api',
	).matches;
	const byRow = groupDiffMatches(matches);
	t.deepEqual(
		(byRow.get(0) ?? []).map(match => match.id),
		['diff:0:0', 'diff:0:1'],
	);
	t.deepEqual(
		(byRow.get(2) ?? []).map(match => match.id),
		['diff:2:0'],
	);
	t.false(byRow.has(1));
});

test('a row is split into plain and highlighted text around its matches', t => {
	t.deepEqual(sliceRowHighlights('plain text', [], null), [
		{text: 'plain text', match: 'none'},
	]);
	t.deepEqual(
		sliceRowHighlights(
			'api and api',
			[hit('diff:0:0', 0, 3), hit('diff:0:1', 8, 11)],
			'diff:0:1',
		),
		[
			{text: 'api', match: 'hit'},
			{text: ' and ', match: 'none'},
			{text: 'api', match: 'active'},
		],
	);
	t.deepEqual(sliceRowHighlights('x api', [hit('diff:0:0', 2, 5)], null), [
		{text: 'x ', match: 'none'},
		{text: 'api', match: 'hit'},
	]);
	t.deepEqual(sliceRowHighlights('', [], null), []);
});

test('highlighted pieces rebuild the row, and bad matches are skipped', t => {
	const text = 'abcdefghij';
	const pieces = sliceRowHighlights(
		text,
		[hit('a', 0, 5), hit('b', 3, 8), hit('c', 8, 20), hit('d', 6, 6)],
		'a',
	);
	t.is(pieces.map(piece => piece.text).join(''), 'abcdefghij');
	t.deepEqual(pieces, [
		{text: 'abcde', match: 'active'},
		{text: 'fghij', match: 'none'},
	]);
});
