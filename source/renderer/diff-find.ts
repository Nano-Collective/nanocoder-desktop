import type {DiffRow} from '@/renderer/diff-parse';
import {MAX_DIFF_ROWS} from '@/renderer/diff-virtual';
import {
	diffScopeLabel,
	type FindMatch,
	findTextRanges,
} from '@/renderer/find-model';

export interface DiffFindTarget {
	rowIndex: number;
	oldLine: number | null;
	newLine: number | null;
	kind: DiffRow['kind'];
}

export type DiffMatch = FindMatch<DiffFindTarget>;

export interface DiffFindResult {
	matches: DiffMatch[];
	// The panel shows at most MAX_DIFF_ROWS rows, so only those are searched.
	capped: boolean;
	searchedRows: number;
	scopeLabel: string;
}

// Literal and case-insensitive, over the rows the panel can show.
export function findDiffMatches(
	rows: readonly DiffRow[],
	query: string,
): DiffFindResult {
	const searchedRows = Math.min(rows.length, MAX_DIFF_ROWS);
	const matches: DiffMatch[] = [];
	for (const [rowIndex, row] of rows.slice(0, searchedRows).entries()) {
		const ranges = findTextRanges(row.text, query);
		for (const [matchInRow, range] of ranges.entries()) {
			matches.push({
				id: `diff:${rowIndex}:${matchInRow}`,
				target: {
					rowIndex,
					oldLine: row.oldLine,
					newLine: row.newLine,
					kind: row.kind,
				},
				start: range.start,
				end: range.end,
			});
		}
	}
	return {
		matches,
		capped: rows.length > MAX_DIFF_ROWS,
		searchedRows,
		scopeLabel: diffScopeLabel(rows.length, MAX_DIFF_ROWS),
	};
}

// Groups matches by row, so one row's hits are found without a full scan.
export function groupDiffMatches(
	matches: readonly DiffMatch[],
): Map<number, DiffMatch[]> {
	const byRow = new Map<number, DiffMatch[]>();
	for (const match of matches) {
		const hits = byRow.get(match.target.rowIndex);
		if (hits) hits.push(match);
		else byRow.set(match.target.rowIndex, [match]);
	}
	return byRow;
}

export interface RowHighlight {
	text: string;
	match: 'none' | 'hit' | 'active';
}

// Splits one row around its matches. The view renders the pieces as text.
export function sliceRowHighlights(
	text: string,
	rowMatches: readonly DiffMatch[],
	activeMatchId: string | null,
): RowHighlight[] {
	const pieces: RowHighlight[] = [];
	let cursor = 0;
	const ordered = [...rowMatches].sort((a, b) => a.start - b.start);
	for (const match of ordered) {
		// Skip a match that overlaps another or leaves the row.
		if (match.start < cursor || match.end <= match.start) continue;
		if (match.end > text.length) continue;
		if (match.start > cursor)
			pieces.push({text: text.slice(cursor, match.start), match: 'none'});
		pieces.push({
			text: text.slice(match.start, match.end),
			match: match.id === activeMatchId ? 'active' : 'hit',
		});
		cursor = match.end;
	}
	if (cursor < text.length)
		pieces.push({text: text.slice(cursor), match: 'none'});
	return pieces;
}
