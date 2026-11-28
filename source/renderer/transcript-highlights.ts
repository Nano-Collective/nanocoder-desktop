import {findPreparedTextRanges, prepareFindQuery} from '@/renderer/find-model';

interface TextSegment<N> {
	node: N | null;
	text: string;
	block?: Element | null;
}

interface FindPoint<N> {
	node: N;
	offset: number;
}

interface FieldFindSpan<N> {
	id: string;
	start: FindPoint<N>;
	end: FindPoint<N>;
	block?: Element | null;
}

function fieldFindSpansPrepared<N>(
	fieldId: string,
	segments: readonly TextSegment<N>[],
	needle: string,
): FieldFindSpan<N>[] {
	if (needle === '' || segments.length === 0) return [];
	const text = segments.map(segment => segment.text).join('');
	const ranges = findPreparedTextRanges(text, needle);
	if (ranges.length === 0) return [];
	const spans: FieldFindSpan<N>[] = [];
	let startIdx = 0;
	let startBase = 0;
	let endIdx = 0;
	let endBase = 0;
	for (const [index, range] of ranges.entries()) {
		while (
			startIdx < segments.length &&
			startBase + segments[startIdx].text.length <= range.start
		) {
			startBase += segments[startIdx].text.length;
			startIdx++;
		}
		if (endIdx < startIdx) {
			endIdx = startIdx;
			endBase = startBase;
		}
		while (
			endIdx < segments.length &&
			endBase + segments[endIdx].text.length < range.end
		) {
			endBase += segments[endIdx].text.length;
			endIdx++;
		}
		const startSeg = segments[startIdx];
		const endSeg = segments[endIdx];
		if (startSeg?.node && endSeg?.node) {
			spans.push({
				id: `${fieldId}:${index}`,
				start: {node: startSeg.node, offset: range.start - startBase},
				end: {node: endSeg.node, offset: range.end - endBase},
				...(startSeg.block === undefined ? {} : {block: startSeg.block}),
			});
		}
	}
	return spans;
}

// Single forward pass over sorted match ranges, so mapping stays linear even
// when a long reply contains thousands of text nodes and hits.
export function fieldFindSpans<N>(
	fieldId: string,
	segments: readonly TextSegment<N>[],
	query: string,
): FieldFindSpan<N>[] {
	return fieldFindSpansPrepared(fieldId, segments, prepareFindQuery(query));
}

const fieldSelector = '[data-find-id]';
// Exclude copy controls and appended localhost host labels, while keeping
// visible localhost link button text searchable and highlightable.
const chromeSelector = '.stream-link-target, .stream-copy, .stream-code-copy';
const blockSelector =
	'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr, td, th';
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

function highlightRegistry() {
	return typeof CSS === 'undefined' ||
		typeof Highlight === 'undefined' ||
		!CSS.highlights
		? null
		: CSS.highlights;
}

function textSegments(field: HTMLElement): TextSegment<Text>[] {
	const segments: TextSegment<Text>[] = [];
	let lastBlock: Element | null = null;
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
		const text = node.textContent ?? '';
		if (text === '') continue;
		const block = node.parentElement?.closest(blockSelector) ?? field;
		// Keep adjacent blocks separated so words never fuse across block boundaries.
		if (lastBlock && block !== lastBlock) {
			const prev = segments.at(-1);
			if (prev && !prev.text.endsWith('\n') && !text.startsWith('\n'))
				segments.push({node: null, text: '\n'});
		}
		lastBlock = block;
		segments.push({node: node as Text, text, block});
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
	activeField: string | null = null,
): PaintedTranscriptFind | null {
	const highlights = highlightRegistry();
	if (!root || !highlights) return null;
	const needle = prepareFindQuery(query);
	if (needle === '') {
		highlights.delete(matchName);
		highlights.delete(activeName);
		return {painted: 0, activeRange: null};
	}
	const bounds = viewport?.getBoundingClientRect();
	const useViewport = Boolean(bounds && bounds.bottom > bounds.top);
	const blockVisibility = new WeakMap<Element, boolean>();
	const isBlockVisible = (block: Element | null | undefined): boolean => {
		if (!useViewport || !bounds || !block) return true;
		const cached = blockVisibility.get(block);
		if (cached !== undefined) return cached;
		const visible = inFindViewport(block.getBoundingClientRect(), bounds);
		blockVisibility.set(block, visible);
		return visible;
	};
	const matches: Range[] = [];
	const active: Range[] = [];
	for (const field of root.querySelectorAll<HTMLElement>(fieldSelector)) {
		const fieldId = field.dataset.findId ?? '';
		const fieldRect = useViewport ? field.getBoundingClientRect() : null;
		if (
			useViewport &&
			bounds &&
			fieldRect &&
			fieldId !== activeField &&
			!inFindViewport(fieldRect, bounds)
		)
			continue;
		const tallField =
			useViewport &&
			bounds !== undefined &&
			fieldRect !== null &&
			fieldRect.height > bounds.bottom - bounds.top + viewportOverscanPx * 2;
		const spans = fieldFindSpansPrepared(fieldId, textSegments(field), needle);
		for (const span of spans) {
			const isActive = span.id === activeId;
			if (!isActive && tallField && !isBlockVisible(span.block)) continue;
			const range = new Range();
			range.setStart(span.start.node, span.start.offset);
			range.setEnd(span.end.node, span.end.offset);
			(isActive ? active : matches).push(range);
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
