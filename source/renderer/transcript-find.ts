import {type FindMatch, findTextRanges} from '@/renderer/find-model';
import {type TranscriptItem, transcriptRowId} from '@/renderer/transcript';

export type TranscriptFindField =
	| 'user'
	| 'agent'
	| 'tool-title'
	| 'tool-location'
	| 'tool-input'
	| 'tool-output'
	| 'tool-content';

// The DOM id of one searchable field; its matches number up from zero.
export function transcriptFieldId(
	rowKey: string,
	field: TranscriptFindField,
	fieldIndex = 0,
): string {
	return `${rowKey}:${field}:${fieldIndex}`;
}

export interface TranscriptFindTarget {
	rowKey: string;
	itemIndex: number;
	field: TranscriptFindField;
	fieldIndex?: number;
	// Tool details sit in a closed disclosure; the host opens it to show a match.
	folded: boolean;
}

export type TranscriptMatch = FindMatch<TranscriptFindTarget>;

interface SearchableField {
	field: TranscriptFindField;
	fieldIndex?: number;
	text: string;
	folded: boolean;
}

type ToolItem = Extract<TranscriptItem, {kind: 'tool'}>;

// The keys ConversationStream renders with: a row id, plus how many earlier
// rows had the same id.
export function transcriptRowKeys(items: readonly TranscriptItem[]): string[] {
	const occurrences = new Map<string, number>();
	return items.map((item, index) => {
		const base = transcriptRowId(item, index);
		const occurrence = occurrences.get(base) ?? 0;
		occurrences.set(base, occurrence + 1);
		return `${base}:${occurrence}`;
	});
}

function formatLocation(location: {path: string; line?: number}): string {
	return location.line === undefined
		? location.path
		: `${location.path}:${location.line}`;
}

function toolFields(item: ToolItem): SearchableField[] {
	const fields: SearchableField[] = [
		{field: 'tool-title', text: item.title, folded: false},
	];
	// A delegation row shows its subagent card instead of these details.
	const details = item.delegation ? undefined : item.details;
	if (!details) return fields;
	for (const [fieldIndex, location] of (details.locations ?? []).entries()) {
		fields.push({
			field: 'tool-location',
			fieldIndex,
			text: formatLocation(location),
			folded: true,
		});
	}
	if (details.input !== undefined)
		fields.push({field: 'tool-input', text: details.input, folded: true});
	if (details.output !== undefined)
		fields.push({field: 'tool-output', text: details.output, folded: true});
	for (const [fieldIndex, text] of (details.content ?? []).entries()) {
		fields.push({field: 'tool-content', fieldIndex, text, folded: true});
	}
	return fields;
}

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
const fenceClose = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const tableDivider =
	/^ {0,3}\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/;
const thematicBreak =
	/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

function stripInlineMarkdown(line: string): string {
	// Keep inline code spans verbatim so syntax inside backticks is never stripped.
	let out = '';
	let cursor = 0;
	while (cursor < line.length) {
		const tick = line.indexOf('`', cursor);
		if (tick < 0) {
			out += stripInlinePlain(line.slice(cursor));
			break;
		}
		out += stripInlinePlain(line.slice(cursor, tick));
		let ticks = 1;
		while (line[tick + ticks] === '`') ticks++;
		const delim = '`'.repeat(ticks);
		const close = line.indexOf(delim, tick + ticks);
		if (close < 0) {
			out += delim;
			cursor = tick + ticks;
		} else {
			let code = line.slice(tick + ticks, close);
			if (
				code.length >= 2 &&
				code.startsWith(' ') &&
				code.endsWith(' ') &&
				code.trim().length > 0
			)
				code = code.slice(1, -1);
			out += code;
			cursor = close + ticks;
		}
	}
	return out;
}

function stripInlinePlain(text: string): string {
	return (
		text
			// Images render as `[image not loaded: alt]` in AgentMarkdown.
			.replace(
				/!\[([^\]]*)\]\([^)]*\)/g,
				(_, alt: string) => `[image not loaded: ${alt || 'image'}]`,
			)
			// Inline links and reference links render their label text only.
			.replace(/\[([^\]]+)\]\((?:[^()\s]+(?:\([^)]*\))?[^)]*)\)/g, '$1')
			.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
			// Autolinks render their address without angle brackets.
			.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1')
			// Emphasis, bold and strikethrough markers.
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/__([^_]+)__/g, '$1')
			.replace(/~~([^~]+)~~/g, '$1')
			.replace(/(^|[^\w\\])\*([^*\n]+)\*/g, '$1$2')
			.replace(/(^|[^\w\\])_([^_\n]+)_/g, '$1$2')
			// CommonMark backslash escapes.
			.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
	);
}

// Projects agent Markdown to the visible text AgentMarkdown renders, so match
// counts, navigation indices and DOM highlight ranges agree.
function markdownSearchText(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	const out: string[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (fence !== null) {
			const close = fenceClose.exec(line);
			if (
				close &&
				close[1][0] === fence[0] &&
				close[1].length >= fence.length
			) {
				fence = null;
			} else {
				out.push(line);
			}
			continue;
		}
		const open = fenceOpen.exec(line);
		if (open) {
			fence = open[1];
			continue;
		}
		// Skip link reference definitions (including multiline labels).
		if (/^ {0,3}\[/.test(line)) {
			let end = i;
			let isDef = false;
			while (end < lines.length && lines[end].trim() !== '') {
				if (/(?:^|[^\\])(?:\\\\)*\]:/.test(lines[end])) {
					isDef = true;
					break;
				}
				if (/(?:^|[^\\])(?:\\\\)*\]/.test(lines[end])) break;
				end++;
			}
			if (isDef) {
				i = end;
				continue;
			}
		}
		if (thematicBreak.test(line) || tableDivider.test(line)) continue;
		let body = line
			.replace(/^(?: {0,3}>[ \t]?)+/, '')
			.replace(/^ {0,3}#{1,6}[ \t]+/, '')
			.replace(/[ \t]+#+[ \t]*$/, '')
			.replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '');
		if (/^ {0,3}\|.*\|[ \t]*$/.test(body)) {
			const cells = body
				.trim()
				.replace(/^\||\|$/g, '')
				.split('|')
				.map(cell => stripInlineMarkdown(cell.trim()));
			out.push(cells.join('\n'));
			continue;
		}
		body = stripInlineMarkdown(body);
		out.push(body);
	}
	return out.join('\n');
}

function fieldsOf(item: TranscriptItem): SearchableField[] {
	switch (item.kind) {
		case 'user':
			return [{field: 'user', text: item.text, folded: false}];
		case 'agent':
			return [
				{field: 'agent', text: markdownSearchText(item.text), folded: false},
			];
		case 'tool':
			return toolFields(item);
		default:
			return [];
	}
}

export function findTranscriptMatches(
	items: readonly TranscriptItem[],
	query: string,
	rowKeys: readonly string[] = transcriptRowKeys(items),
): TranscriptMatch[] {
	const matches: TranscriptMatch[] = [];
	if (query === '') return matches;
	for (const [itemIndex, item] of items.entries()) {
		const rowKey = rowKeys[itemIndex];
		for (const field of fieldsOf(item)) {
			const ranges = findTextRanges(field.text, query);
			for (const [occurrence, range] of ranges.entries()) {
				matches.push({
					id: `${transcriptFieldId(rowKey, field.field, field.fieldIndex)}:${occurrence}`,
					target: {
						rowKey,
						itemIndex,
						field: field.field,
						...(field.fieldIndex === undefined
							? {}
							: {fieldIndex: field.fieldIndex}),
						folded: field.folded,
					},
					start: range.start,
					end: range.end,
				});
			}
		}
	}
	return matches;
}
