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

function fieldsOf(item: TranscriptItem): SearchableField[] {
	switch (item.kind) {
		case 'user':
		case 'agent':
			return [{field: item.kind, text: item.text, folded: false}];
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
