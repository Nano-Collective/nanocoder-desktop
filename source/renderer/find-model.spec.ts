import test from 'ava';
import {
	closeFind,
	detectFindFocusContext,
	diffScopeLabel,
	findKeyAction,
	findStatus,
	findTextRanges,
	initialFindState,
	openFind,
	reconcileFindMatches,
	routeFindShortcut,
	setFindQuery,
	stepFind,
	transcriptScopeLabel,
} from '@/renderer/find-model';

function match(id: string) {
	return {id, target: id, start: 0, end: 1};
}

function searched(ids: string[], query = 'api') {
	const typed = setFindQuery(openFind(initialFindState<string>()), query);
	return reconcileFindMatches(typed, ids.map(match));
}

function node(...selectors: string[]): EventTarget {
	return {
		closest: (selector: string) => (selectors.includes(selector) ? {} : null),
	} as unknown as EventTarget;
}

test('opening keeps the query; closing drops results but keeps the query', t => {
	const state = searched(['a', 'b'], 'api');
	t.true(state.open);
	t.is(state.activeId, 'a');
	const closed = closeFind(state);
	t.false(closed.open);
	t.is(closed.query, 'api');
	t.deepEqual(closed.matches, []);
	t.is(closed.activeIndex, -1);
	t.is(closed.activeId, null);
	const reopened = openFind(closed);
	t.true(reopened.open);
	t.is(reopened.query, 'api');
	t.is(openFind(reopened), reopened);
});

test('a new query clears the active result, and the same query keeps it', t => {
	const state = stepFind(searched(['a', 'b', 'c']), 1);
	t.is(state.activeId, 'b');
	t.is(setFindQuery(state, state.query), state);
	const changed = setFindQuery(state, 'other');
	t.is(changed.query, 'other');
	t.deepEqual(changed.matches, []);
	t.is(changed.activeIndex, -1);
	t.is(changed.activeId, null);
});

test('stepping wraps forward and backward through the results', t => {
	const first = searched(['a', 'b', 'c']);
	t.is(first.activeId, 'a');
	const second = stepFind(first, 1);
	t.is(second.activeId, 'b');
	t.is(stepFind(stepFind(second, 1), 1).activeId, 'a');
	t.is(stepFind(first, -1).activeId, 'c');
});

test('stepping with no active result starts at the first or last result', t => {
	const idle = {...searched(['a', 'b', 'c']), activeIndex: -1, activeId: null};
	t.is(stepFind(idle, 1).activeId, 'a');
	t.is(stepFind(idle, -1).activeId, 'c');
	t.is(stepFind(searched([]), 1).activeId, null);
});

test('reconciling keeps the active result by id when the matches change', t => {
	const moved = stepFind(searched(['a', 'b', 'c']), 1);
	const updated = reconcileFindMatches(moved, [
		match('x'),
		match('c'),
		match('b'),
	]);
	t.is(updated.activeId, 'b');
	t.is(updated.activeIndex, 2);
});

test('reconciling clamps the position when the active result is gone', t => {
	const last = stepFind(stepFind(searched(['a', 'b', 'c']), 1), 1);
	t.is(last.activeIndex, 2);
	const shorter = reconcileFindMatches(last, [match('a'), match('b')]);
	t.is(shorter.activeIndex, 1);
	t.is(shorter.activeId, 'b');
});

test('reconciling starts at the first result, and clears when nothing matches', t => {
	const typed = setFindQuery(openFind(initialFindState<string>()), 'api');
	const found = reconcileFindMatches(typed, [match('a'), match('b')]);
	t.is(found.activeIndex, 0);
	t.is(found.activeId, 'a');
	const none = reconcileFindMatches(found, []);
	t.is(none.activeIndex, -1);
	t.is(none.activeId, null);
	t.deepEqual(none.matches, []);
});

test('text search ignores case and matches the query literally', t => {
	t.deepEqual(findTextRanges('Alpha alpha ALPHA', 'alpha'), [
		{start: 0, end: 5},
		{start: 6, end: 11},
		{start: 12, end: 17},
	]);
	t.deepEqual(findTextRanges('a.c abc a.c', 'a.c'), [
		{start: 0, end: 3},
		{start: 8, end: 11},
	]);
	t.deepEqual(findTextRanges('f(x) = [1]', '(x)'), [{start: 1, end: 4}]);
	t.deepEqual(findTextRanges('plain', '.*'), []);
});

test('text search keeps every match and never overlaps them', t => {
	t.is(findTextRanges('a'.repeat(10_000), 'a').length, 10_000);
	t.deepEqual(findTextRanges('aaaa', 'aa'), [
		{start: 0, end: 2},
		{start: 2, end: 4},
	]);
	t.deepEqual(findTextRanges('anything', ''), []);
});

test('text search keeps offsets right when lowercasing changes the length', t => {
	t.deepEqual(findTextRanges('İx', 'x'), [{start: 1, end: 2}]);
	t.deepEqual(findTextRanges('ΑΣ', 'ας'), [{start: 0, end: 2}]);
});

test('keys in the find box step, close, or select the query', t => {
	const base = {
		key: '',
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		composing: false,
	};
	t.is(findKeyAction({...base, key: 'Enter'}), 'next');
	t.is(findKeyAction({...base, key: 'Enter', shiftKey: true}), 'previous');
	t.is(findKeyAction({...base, key: 'Escape'}), 'close');
	t.is(findKeyAction({...base, key: 'f', metaKey: true}), 'select-all');
	t.is(findKeyAction({...base, key: 'F', ctrlKey: true}), 'select-all');
	t.is(findKeyAction({...base, key: 'f'}), 'none');
	t.is(findKeyAction({...base, key: 'a', metaKey: true}), 'none');
	t.is(findKeyAction({...base, key: 'Enter', composing: true}), 'none');
});

test('status text counts results and names the scope', t => {
	t.is(findStatus('api', 2, 12, 'open diff'), '3 of 12 · open diff');
	t.is(
		findStatus('api', -1, 0, transcriptScopeLabel),
		'no matches in loaded transcript',
	);
	t.is(findStatus('', -1, 0, 'open diff'), 'open diff');
});

test('the diff scope names the first 5,000 rows only when the diff is longer', t => {
	t.is(diffScopeLabel(5000, 5000), 'open diff');
	t.is(diffScopeLabel(5001, 5000), 'first 5,000 diff rows');
	t.is(
		findStatus('x', -1, 0, diffScopeLabel(5001, 5000)),
		'no matches in first 5,000 diff rows',
	);
});

test('shortcuts go to the diff or the transcript, never inside a modal, terminal or browser', t => {
	const base = {
		modalOpen: false,
		inTerminal: false,
		inBrowser: false,
		inDiff: false,
		hasDiff: false,
		hasTranscript: true,
	};
	t.is(routeFindShortcut({...base, modalOpen: true}), 'ignore');
	t.is(
		routeFindShortcut({...base, inTerminal: true, inDiff: true, hasDiff: true}),
		'ignore',
	);
	t.is(routeFindShortcut({...base, inBrowser: true}), 'ignore');
	t.is(routeFindShortcut({...base, inDiff: true, hasDiff: true}), 'diff');
	t.is(routeFindShortcut({...base, inDiff: true}), 'transcript');
	t.is(routeFindShortcut(base), 'transcript');
	t.is(routeFindShortcut({...base, hasTranscript: false}), 'ignore');
});

test('focus context comes from the terminal, browser or diff ancestor', t => {
	const none = {inTerminal: false, inBrowser: false, inDiff: false};
	t.deepEqual(detectFindFocusContext(node('.terminal-panel')), {
		...none,
		inTerminal: true,
	});
	t.deepEqual(detectFindFocusContext(node('#workbench-panel-browser')), {
		...none,
		inBrowser: true,
	});
	t.deepEqual(detectFindFocusContext(node('.diff-view')), {
		...none,
		inDiff: true,
	});
	t.deepEqual(detectFindFocusContext(null), none);
	t.deepEqual(detectFindFocusContext({} as EventTarget), none);
});
