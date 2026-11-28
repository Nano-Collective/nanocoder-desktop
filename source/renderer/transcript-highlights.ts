import {findTextRanges} from '@/renderer/find-model';

interface TextSegment<N> {
	node: N;
	text: string;
}

interface FindPoint<N> {
	node: N;
	offset: number;
}

interface FieldFindSpan<N> {
	id: string;
	start: FindPoint<N>;
	end: FindPoint<N>;
}

// An end offset is exclusive, so it belongs to the node holding the last character.
function locate<N>(
	segments: readonly TextSegment<N>[],
	offset: number,
	end: boolean,
): FindPoint<N> | undefined {
	let base = 0;
	for (const segment of segments) {
		const limit = base + segment.text.length;
		const inside = end
			? offset > base && offset <= limit
			: offset >= base && offset < limit;
		if (inside) return {node: segment.node, offset: offset - base};
		base = limit;
	}
	return undefined;
}

// A field's text can span several nodes, so each edge goes in the node holding it.
export function fieldFindSpans<N>(
	fieldId: string,
	segments: readonly TextSegment<N>[],
	query: string,
): FieldFindSpan<N>[] {
	const text = segments.map(segment => segment.text).join('');
	const spans: FieldFindSpan<N>[] = [];
	for (const [index, range] of findTextRanges(text, query).entries()) {
		const start = locate(segments, range.start, false);
		const end = locate(segments, range.end, true);
		if (start && end) spans.push({id: `${fieldId}:${index}`, start, end});
	}
	return spans;
}

const fieldSelector = '[data-find-id]';
// Link hosts and copy buttons are chrome, not reported text.
const chromeSelector = '.stream-link-target, button';
const matchName = 'find-match';
const activeName = 'find-active';
const viewportOverscanPx = 300;

export interface VerticalBounds {
	top: number;
	bottom: number;
}

export interface PaintedTranscriptFind {
	painted: number;
	activeRange: Range | null;
}

// Bounds highlighting to rows near the visible viewport so long transcripts
// do not walk offscreen DOM on every stream update.
export function inFindViewport(
	field: VerticalBounds,
	viewport: VerticalBounds,
	overscan = viewportOverscanPx,
): boolean {
	return (
		field.bottom >= viewport.top - overscan &&
		field.top <= viewport.bottom + overscan
	);
}

function activeFieldOf(activeId: string | null): string | null {
	if (!activeId) return null;
	const separator = activeId.lastIndexOf(':');
	return separator > 0 ? activeId.slice(0, separator) : null;
}

function highlightRegistry() {
	return typeof CSS === 'undefined' ||
		typeof Highlight === 'undefined' ||
		!CSS.highlights
		? null
		: CSS.highlights;
}

function textSegments(field: HTMLElement): TextSegment<Text>[] {
	const segments: TextSegment<Text>[] = [];
	const walker = field.ownerDocument.createTreeWalker(
		field,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		{
			acceptNode(node) {
				if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
				return (node as Element).matches(chromeSelector)
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_SKIP;
			},
		},
	);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		segments.push({node: node as Text, text: node.textContent ?? ''});
	}
	return segments;
}

function highlightOf(ranges: Range[]): Highlight {
	const highlight = new Highlight();
	for (const range of ranges) highlight.add(range);
	return highlight;
}

// Paints visible fields' matches, with the active one stronger. Returns how
// many ranges were painted and the active Range, or null outside a browser.
export function paintTranscriptFind(
	root: ParentNode | null,
	query: string,
	activeId: string | null,
	viewport?: HTMLElement | null,
): PaintedTranscriptFind | null {
	const highlights = highlightRegistry();
	if (!root || !highlights) return null;
	const bounds = viewport?.getBoundingClientRect();
	const useViewport = Boolean(bounds && bounds.bottom > bounds.top);
	const activeField = activeFieldOf(activeId);
	const matches: Range[] = [];
	const active: Range[] = [];
	for (const field of root.querySelectorAll<HTMLElement>(fieldSelector)) {
		const fieldId = field.dataset.findId ?? '';
		if (
			useViewport &&
			bounds &&
			fieldId !== activeField &&
			!inFindViewport(field.getBoundingClientRect(), bounds)
		)
			continue;
		const spans = fieldFindSpans(fieldId, textSegments(field), query);
		for (const span of spans) {
			const range = new Range();
			range.setStart(span.start.node, span.start.offset);
			range.setEnd(span.end.node, span.end.offset);
			(span.id === activeId ? active : matches).push(range);
		}
	}
	if (matches.length > 0) highlights.set(matchName, highlightOf(matches));
	else highlights.delete(matchName);
	if (active.length > 0) highlights.set(activeName, highlightOf(active));
	else highlights.delete(activeName);
	return {
		painted: matches.length + active.length,
		activeRange: active[0] ?? null,
	};
}

export function clearTranscriptFind(): void {
	const highlights = highlightRegistry();
	highlights?.delete(matchName);
	highlights?.delete(activeName);
}
