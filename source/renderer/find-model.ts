export interface FindMatch<T> {
	id: string;
	target: T;
	start: number;
	end: number;
}

export interface FindState<T> {
	open: boolean;
	query: string;
	matches: readonly FindMatch<T>[];
	// -1 when there are no matches.
	activeIndex: number;
	activeId: string | null;
}

export interface TextRange {
	start: number;
	end: number;
}

export const transcriptScopeLabel = 'loaded transcript';

export function diffScopeLabel(totalRows: number, limit: number): string {
	return totalRows > limit
		? `first ${limit.toLocaleString('en')} diff rows`
		: 'open diff';
}

export function initialFindState<T>(): FindState<T> {
	return {
		open: false,
		query: '',
		matches: [],
		activeIndex: -1,
		activeId: null,
	};
}

export function openFind<T>(state: FindState<T>): FindState<T> {
	return state.open ? state : {...state, open: true};
}

// The query survives a close; matches and the active result do not.
export function closeFind<T>(state: FindState<T>): FindState<T> {
	if (
		!state.open &&
		state.matches.length === 0 &&
		state.activeIndex === -1 &&
		state.activeId === null
	)
		return state;
	return {...state, open: false, matches: [], activeIndex: -1, activeId: null};
}

export function setFindQuery<T>(
	state: FindState<T>,
	query: string,
): FindState<T> {
	if (query === state.query) return state;
	return {...state, query, matches: [], activeIndex: -1, activeId: null};
}

export function stepFind<T>(state: FindState<T>, delta: 1 | -1): FindState<T> {
	const {matches} = state;
	const count = matches.length;
	if (count === 0)
		return state.activeIndex === -1 && state.activeId === null
			? state
			: {...state, activeIndex: -1, activeId: null};
	const current = Math.min(state.activeIndex, count - 1);
	const start = delta === 1 ? 0 : count - 1;
	const next = current < 0 ? start : (current + delta + count) % count;
	return activate(state, matches, next);
}

// Keeps the active result when its id survives; otherwise keeps its position.
export function reconcileFindMatches<T>(
	state: FindState<T>,
	matches: readonly FindMatch<T>[],
): FindState<T> {
	const kept = matches.findIndex(match => match.id === state.activeId);
	return activate(state, matches, kept >= 0 ? kept : state.activeIndex);
}

function activate<T>(
	state: FindState<T>,
	matches: readonly FindMatch<T>[],
	index: number,
): FindState<T> {
	if (matches.length === 0) {
		if (
			state.matches.length === 0 &&
			state.activeIndex === -1 &&
			state.activeId === null
		)
			return state;
		return {...state, matches, activeIndex: -1, activeId: null};
	}
	const activeIndex = Math.min(Math.max(index, 0), matches.length - 1);
	const activeId = matches[activeIndex].id;
	if (
		state.matches === matches &&
		state.activeIndex === activeIndex &&
		state.activeId === activeId
	)
		return state;
	return {...state, matches, activeIndex, activeId};
}

export function findStatus(
	query: string,
	activeIndex: number,
	total: number,
	scopeLabel: string,
): string {
	if (total === 0) return query ? `no matches in ${scopeLabel}` : scopeLabel;
	return `${activeIndex + 1} of ${total} · ${scopeLabel}`;
}

export type FindRoute = 'ignore' | 'diff' | 'transcript';

export interface FindRouteContext {
	modalOpen: boolean;
	inTerminal: boolean;
	inBrowser: boolean;
	inDiff: boolean;
	hasDiff: boolean;
	hasTranscript: boolean;
}

export function routeFindShortcut(context: FindRouteContext): FindRoute {
	if (context.modalOpen || context.inTerminal || context.inBrowser)
		return 'ignore';
	if (context.inDiff && context.hasDiff) return 'diff';
	return context.hasTranscript ? 'transcript' : 'ignore';
}

export interface FindFocusContext {
	inTerminal: boolean;
	inBrowser: boolean;
	inDiff: boolean;
}

const terminalSelectors = ['.terminal-panel'];
const browserSelectors = ['.browser-panel', '#workbench-panel-browser'];
const diffSelectors = ['.review-diff', '.diff-view'];

function within(
	target: EventTarget | null,
	selectors: readonly string[],
): boolean {
	if (!target || !('closest' in target)) return false;
	if (typeof target.closest !== 'function') return false;
	for (const selector of selectors) {
		if (target.closest(selector)) return true;
	}
	return false;
}

// DOM-safe: a null target, or one without closest, is outside every panel.
export function detectFindFocusContext(
	target: EventTarget | null,
): FindFocusContext {
	return {
		inTerminal: within(target, terminalSelectors),
		inBrowser: within(target, browserSelectors),
		inDiff: within(target, diffSelectors),
	};
}

// Lowercasing can change a string's length (İ becomes two code units). Folding
// one code point at a time keeps each length, so offsets stay valid.
function fold(value: string): string {
	return value.toLowerCase().replaceAll('ς', 'σ');
}

function foldText(value: string): string {
	const folded = fold(value);
	if (folded.length === value.length) return folded;
	let result = '';
	for (const char of value) {
		const lowered = fold(char);
		result += lowered.length === char.length ? lowered : char;
	}
	return result;
}

// Prepares a literal query once so scanning many fields avoids re-folding it.
export function prepareFindQuery(query: string): string {
	return query === '' ? '' : foldText(query);
}

export function findPreparedTextRanges(
	text: string,
	needle: string,
): TextRange[] {
	if (needle === '' || text.length < needle.length) return [];
	const haystack = foldText(text);
	const ranges: TextRange[] = [];
	let from = haystack.indexOf(needle);
	while (from >= 0) {
		ranges.push({start: from, end: from + needle.length});
		from = haystack.indexOf(needle, from + needle.length);
	}
	return ranges;
}

// Case-insensitive and literal: no regular expression, and no cap on matches.
export function findTextRanges(text: string, query: string): TextRange[] {
	return findPreparedTextRanges(text, prepareFindQuery(query));
}

export interface FindKey {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	composing: boolean;
}

export type FindKeyAction =
	| 'next'
	| 'previous'
	| 'close'
	| 'select-all'
	| 'none';

// Enter steps, Escape closes, and Cmd or Ctrl+F selects the query.
export function findKeyAction(key: FindKey): FindKeyAction {
	if (key.composing) return 'none';
	if (key.key === 'Escape') return 'close';
	if (key.key === 'Enter') return key.shiftKey ? 'previous' : 'next';
	if ((key.metaKey || key.ctrlKey) && key.key.toLowerCase() === 'f')
		return 'select-all';
	return 'none';
}
