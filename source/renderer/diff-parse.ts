export type DiffRowKind =
	| 'file'
	| 'hunk'
	| 'add'
	| 'remove'
	| 'context'
	| 'note';

export interface DiffRow {
	kind: DiffRowKind;
	text: string;
	// Line numbers in the old and new file; absent on headers.
	oldLine: number | null;
	newLine: number | null;
	// Index among selectable rows, or -1 for headers.
	selectable: boolean;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

// Parses Git's unified diff for display. Header lines (diff, index, rename,
// ---/+++) are shown but cannot carry a review comment; only lines of change
// and context can, and they carry the line numbers a comment refers to.
export function parseDiff(diff: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	const lines = diff.split('\n');
	if (lines.at(-1) === '') lines.pop();
	for (const line of lines) {
		const hunk = HUNK.exec(line);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			inHunk = true;
			rows.push({
				kind: 'hunk',
				text: line,
				oldLine: null,
				newLine: null,
				selectable: false,
			});
			continue;
		}
		if (!inHunk) {
			rows.push({
				kind: 'file',
				text: line,
				oldLine: null,
				newLine: null,
				selectable: false,
			});
			continue;
		}
		if (line.startsWith('\\')) {
			rows.push({
				kind: 'note',
				text: line,
				oldLine: null,
				newLine: null,
				selectable: false,
			});
		} else if (line.startsWith('+')) {
			rows.push({
				kind: 'add',
				text: line.slice(1),
				oldLine: null,
				newLine: newLine++,
				selectable: true,
			});
		} else if (line.startsWith('-')) {
			rows.push({
				kind: 'remove',
				text: line.slice(1),
				oldLine: oldLine++,
				newLine: null,
				selectable: true,
			});
		} else if (line.startsWith('diff --git')) {
			inHunk = false;
			rows.push({
				kind: 'file',
				text: line,
				oldLine: null,
				newLine: null,
				selectable: false,
			});
		} else {
			rows.push({
				kind: 'context',
				text: line.startsWith(' ') ? line.slice(1) : line,
				oldLine: oldLine++,
				newLine: newLine++,
				selectable: true,
			});
		}
	}
	return rows;
}

export interface LineSelection {
	startLine: number;
	endLine: number;
	// Text of the selected diff rows, with +, - or a space in front.
	excerpt: string;
}

const MARKER: Record<DiffRowKind, string> = {
	add: '+',
	remove: '-',
	context: ' ',
	file: '',
	hunk: '',
	note: '',
};

// A selection is a run of rows between two selectable rows. A comment refers to
// the new file's line numbers; removed lines use the old file's numbers, which
// is how Git itself reports them.
export function selectLines(
	rows: readonly DiffRow[],
	from: number,
	to: number,
): LineSelection | null {
	const first = Math.min(from, to);
	const last = Math.max(from, to);
	const chosen = rows.slice(first, last + 1).filter(row => row.selectable);
	if (!chosen.length) return null;
	const numbers = chosen.map(row => row.newLine ?? row.oldLine ?? 0);
	return {
		startLine: Math.min(...numbers),
		endLine: Math.max(...numbers),
		excerpt: chosen.map(row => `${MARKER[row.kind]}${row.text}`).join('\n'),
	};
}

export interface DiffCursor {
	anchor: number;
	cursor: number;
}

// Arrow keys move over selectable rows only; Shift keeps the anchor, so a range
// grows from where it started. Without a cursor, the first row is chosen.
export function diffKey(
	rows: readonly DiffRow[],
	state: DiffCursor | null,
	key: string,
	shift: boolean,
): DiffCursor | null {
	const selectable = rows.flatMap((row, index) =>
		row.selectable ? [index] : [],
	);
	if (!selectable.length) return null;
	const at = state ? selectable.findIndex(index => index >= state.cursor) : -1;
	let target: number;
	switch (key) {
		case 'ArrowDown':
			target = state
				? selectable[
						Math.min(
							selectable.length - 1,
							at < 0 ? 0 : selectable[at] === state.cursor ? at + 1 : at,
						)
					]
				: selectable[0];
			break;
		case 'ArrowUp':
			target = state
				? selectable[Math.max(0, (at < 0 ? selectable.length : at) - 1)]
				: selectable[0];
			break;
		case 'Home':
			target = selectable[0];
			break;
		case 'End':
			target = selectable[selectable.length - 1];
			break;
		case 'Enter':
		case ' ':
			target = state?.cursor ?? selectable[0];
			return {anchor: target, cursor: target};
		default:
			return null;
	}
	return {anchor: shift && state ? state.anchor : target, cursor: target};
}
