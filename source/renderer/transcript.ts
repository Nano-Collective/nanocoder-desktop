import type {
	PermissionRequestInfo,
	StreamCommand,
	StreamConfigOption,
	StreamMetadata,
	StreamPlan,
	StreamToolDetails,
	TurnEvent,
} from '@/shared/ipc';

export interface FailureAnchor {
	turn: number;
	messageId?: string;
	textDigest?: string;
}

export type TranscriptItem = (
	| {
			kind: 'user' | 'agent';
			text: string;
			messageId?: string;
			rowId?: string;
			attachmentSummary?: string[];
			// Epoch ms seen live by this renderer; never persisted or estimated.
			at?: number;
	  }
	| {kind: 'thought'; text: string; messageId?: string; rowId?: string}
	| {kind: 'turn-metadata'}
	| {
			kind: 'failure';
			text: string;
			rowId?: string;
			// Immutable turn anchor recorded when the failure occurred; null means unanchored.
			anchor?: FailureAnchor | null;
	  }
	| {
			kind: 'tool';
			id: string;
			title: string;
			status: string;
			toolKind?: string;
			details?: StreamToolDetails;
			delegation?: import('@/shared/subagents').SubagentDisplay;
			approvalOnly?: true;
			historyOutcome?: 'unknown' | 'completed' | 'failed' | 'interrupted';
			turnOutcome?: 'completed' | 'failed' | 'cancelled';
	  }
	| {kind: 'plan'; id: string | null; content: StreamPlan}
	| {kind: 'notice'; severity: string; title: string; description?: string}
	| {
			kind: 'compaction';
			id: string;
			status: string;
			summary?: string | null;
			error?: string | null;
	  }
	| {
			kind: 'subagent';
			id: string;
			title?: string | null;
			description?: string | null;
			state?: string | null;
	  }
	| {
			kind: 'session-message';
			id: string;
			sender?: string;
			recipient?: string;
			text: string;
	  }
) & {metadata?: StreamMetadata};

export interface Transcript {
	items: TranscriptItem[];
	// Every request still waiting for an answer, oldest first.
	permissions: PermissionRequestInfo[];
	commands?: StreamCommand[];
	mode?: string;
	config?: StreamConfigOption[];
	context?: {
		used: number;
		size: number;
		cost?: {amount: number; currency: string};
	};
}

export const emptyTranscript: Transcript = {items: [], permissions: []};

export function settleSubagentTurn(
	transcript: Transcript,
	outcome: 'completed' | 'failed' | 'cancelled',
): Transcript {
	const start = currentTurnStart(transcript.items);
	let changed = false;
	const items = transcript.items.map((item, index) => {
		if (
			index <= start ||
			item.kind !== 'tool' ||
			!item.delegation ||
			item.delegation.history ||
			item.turnOutcome ||
			!['pending', 'in_progress'].includes(item.status)
		)
			return item;
		changed = true;
		return {...item, turnOutcome: outcome};
	});
	return changed ? {...transcript, items} : transcript;
}

export function currentTurnStart(items: readonly TranscriptItem[]): number {
	for (let index = items.length - 1; index >= 0; index--)
		if (items[index].kind === 'user') return index;
	return -1;
}

function fingerprint(text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++)
		hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}

// Compact 64-bit-pair + length digest so evicted anchors and timestamps
// never retain raw prompt or reply text in memory.
function textDigest(text: string): string {
	let h1 = 2166136261;
	let h2 = 33554467;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 16777619);
		h2 = Math.imul(h2 ^ (code + index), 2246822519);
	}
	return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${text.length.toString(36)}`;
}

function compactMessageKey(item: Message): string | undefined {
	if (item.kind === 'agent' && item.text === '') return undefined;
	return item.messageId === undefined
		? `${item.kind}:digest:${textDigest(item.text)}`
		: `${item.kind}:id:${item.messageId}`;
}

function fallbackRowId(kind: string, index: number, text: string): string {
	return `${kind}:${index}:${fingerprint(text)}`;
}

export function transcriptRowId(item: TranscriptItem, index: number): string {
	if ('id' in item && item.id !== null) return `${item.kind}:${item.id}`;
	if ('messageId' in item && item.messageId)
		return `${item.kind}:${item.messageId}`;
	if ('rowId' in item && item.rowId) return `${item.kind}:${item.rowId}`;
	const text =
		'text' in item && typeof item.text === 'string'
			? item.text
			: 'title' in item && typeof item.title === 'string'
				? item.title
				: '';
	return fallbackRowId(item.kind, index, text);
}

type Message = Extract<TranscriptItem, {kind: 'user' | 'agent'}>;
type FailureItem = Extract<TranscriptItem, {kind: 'failure'}>;

function anchorForUser(turn: number, user: Message | undefined): FailureAnchor {
	if (!user) return {turn: 0};
	return user.messageId !== undefined
		? {turn, messageId: user.messageId}
		: {turn, textDigest: textDigest(user.text)};
}

// A failure belongs to the turn that was current when it was recorded.
// Pass anchored = false when a prompt failed before its user row appeared.
export function appendFailure(
	transcript: Transcript,
	text: string,
	anchored = true,
): Transcript {
	let turns = 0;
	let failures = 0;
	let lastUser: Message | undefined;
	for (const item of transcript.items) {
		if (item.kind === 'user') {
			turns++;
			lastUser = item;
		} else if (item.kind === 'failure') {
			failures++;
		}
	}
	return {
		...transcript,
		items: [
			...transcript.items,
			{
				kind: 'failure',
				text,
				rowId: `${turns}:${failures}`,
				anchor: anchored ? anchorForUser(turns, lastUser) : null,
			},
		],
	};
}

function matchesFailureAnchor(
	anchor: FailureAnchor | null | undefined,
	seenTurn: number,
	seenUser: Message | undefined,
): boolean {
	if (!anchor || anchor.turn !== seenTurn) return false;
	if (seenTurn === 0) return true;
	if (!seenUser) return false;
	if (anchor.messageId !== undefined || seenUser.messageId !== undefined)
		return anchor.messageId === seenUser.messageId;
	return anchor.textDigest === textDigest(seenUser.text);
}

interface AnchoredFailure {
	item: FailureItem;
	anchor: FailureAnchor | null;
}

function collectAnchoredFailures(
	items: readonly TranscriptItem[],
): AnchoredFailure[] {
	const result: AnchoredFailure[] = [];
	let turns = 0;
	let currentUser: Message | undefined;
	for (const item of items) {
		if (item.kind === 'user') {
			turns++;
			currentUser = item;
		} else if (item.kind === 'failure') {
			result.push({
				item,
				anchor:
					item.anchor === undefined
						? anchorForUser(turns, currentUser)
						: item.anchor,
			});
		}
	}
	return result;
}

export interface EvictedThreadMemory {
	failures: readonly FailureItem[];
	times: ReadonlyMap<string, number>;
}

// Keeps compact failure anchors and live session timestamps when an idle view
// is evicted, without holding raw prompt or reply text in memory.
export function extractEvictedThread(
	transcript: Transcript,
): EvictedThreadMemory | null {
	const failures = collectAnchoredFailures(transcript.items).map(
		({item, anchor}) => (item.anchor === undefined ? {...item, anchor} : item),
	);
	const counts = new Map<string, number>();
	const singleTimes = new Map<string, number>();
	for (const item of transcript.items) {
		if (!isMessage(item)) continue;
		const key = compactMessageKey(item);
		if (key === undefined) continue;
		const nextCount = (counts.get(key) ?? 0) + 1;
		counts.set(key, nextCount);
		if (nextCount === 1 && item.at !== undefined) singleTimes.set(key, item.at);
		else singleTimes.delete(key);
	}
	if (failures.length === 0 && singleTimes.size === 0) return null;
	return {failures, times: singleTimes};
}

// Re-inserts each failure after the turn that failed (before the next user
// message), so a snapshot keeps it beside its turn. Unanchored failures or
// failures whose immutable anchor no longer matches stay last without
// attaching to another turn.
export function carryFailureRows(
	previous: Transcript,
	next: Transcript,
	remembered?: readonly FailureItem[],
): Transcript {
	const collected = collectAnchoredFailures(previous.items);
	const source: readonly AnchoredFailure[] =
		collected.length > 0
			? collected
			: (remembered ?? []).map(item => ({
					item,
					anchor: item.anchor ?? null,
				}));
	if (source.length === 0) return next;
	const grouped = new Map<number, AnchoredFailure[]>();
	const unanchored: FailureItem[] = [];
	for (const entry of source) {
		if (!entry.anchor) {
			unanchored.push(entry.item);
			continue;
		}
		const bucket = grouped.get(entry.anchor.turn);
		if (bucket) bucket.push(entry);
		else grouped.set(entry.anchor.turn, [entry]);
	}
	const placed = new Set<AnchoredFailure>();
	const items: TranscriptItem[] = [];
	let seen = 0;
	let seenUser: Message | undefined;
	for (const item of next.items) {
		if (item.kind === 'user') {
			const candidates = grouped.get(seen);
			if (candidates) {
				for (const entry of candidates) {
					if (matchesFailureAnchor(entry.anchor, seen, seenUser)) {
						items.push(entry.item);
						placed.add(entry);
					}
				}
			}
			seen++;
			seenUser = item;
		}
		items.push(item);
	}
	for (const entry of source) {
		if (placed.has(entry) || !entry.anchor) continue;
		if (matchesFailureAnchor(entry.anchor, seen, seenUser)) {
			items.push(entry.item);
		} else {
			items.push(
				entry.item.anchor === undefined
					? {...entry.item, anchor: entry.anchor}
					: entry.item,
			);
		}
	}
	for (const item of unanchored) items.push(item);
	return {...next, items};
}

interface BatchCursor {
	turnStart: number | undefined;
	toolIndex: Map<string, number> | null;
}

// Each batch copies the list at most once, lazily on the first item write.
function upsert(
	mutableItems: () => TranscriptItem[],
	readItems: readonly TranscriptItem[],
	matches: (item: TranscriptItem) => boolean,
	update: (previous?: TranscriptItem) => TranscriptItem,
	floor = -1,
): void {
	let index = -1;
	for (let cursor = floor + 1; cursor < readItems.length; cursor++) {
		if (matches(readItems[cursor])) {
			index = cursor;
			break;
		}
	}
	const items = mutableItems();
	if (index >= 0) items[index] = update(items[index]);
	else items.push(update());
}

function applyContent(
	draft: Transcript,
	mutableItems: () => TranscriptItem[],
	cursor: BatchCursor,
	event: TurnEvent,
	at: number | undefined,
): void {
	switch (event.type) {
		case 'metadata':
			return;
		case 'commands':
			draft.commands = event.commands;
			return;
		case 'mode':
			draft.mode = event.id;
			return;
		case 'config':
			draft.config = event.options;
			return;
		case 'context':
			draft.context = {
				used: event.used,
				size: event.size,
				...(event.cost ? {cost: event.cost} : {}),
			};
			return;
		case 'user':
		case 'text':
		case 'thought': {
			const items = mutableItems();
			const kind = event.type === 'text' ? 'agent' : event.type;
			const last = items.at(-1);
			const join =
				last?.kind === kind &&
				last.messageId === event.messageId &&
				(kind !== 'user' || event.messageId !== undefined);
			const item: TranscriptItem = join
				? {...last, text: last.text + event.text}
				: {
						kind,
						text: event.text,
						...(event.type === 'user' && event.attachmentSummary
							? {attachmentSummary: event.attachmentSummary}
							: {}),
						...(event.messageId
							? {messageId: event.messageId}
							: {rowId: fallbackRowId('live', items.length, event.text)}),
						...(at !== undefined && kind !== 'thought' ? {at} : {}),
					};
			if (join) items[items.length - 1] = item;
			else items.push(item);
			if (kind === 'user') {
				cursor.turnStart = items.length - 1;
				cursor.toolIndex = null;
			}
			return;
		}
		case 'tool': {
			if (cursor.turnStart === undefined)
				cursor.turnStart = currentTurnStart(draft.items);
			if (cursor.toolIndex === null) {
				cursor.toolIndex = new Map<string, number>();
				for (
					let index = cursor.turnStart + 1;
					index < draft.items.length;
					index++
				) {
					const row = draft.items[index];
					if (row.kind === 'tool' && !cursor.toolIndex.has(row.id))
						cursor.toolIndex.set(row.id, index);
				}
			}
			const existingIndex = cursor.toolIndex.get(event.id);
			const items = mutableItems();
			const previous =
				existingIndex !== undefined ? items[existingIndex] : undefined;
			const known = previous?.kind === 'tool' ? previous : undefined;
			const nextTool: TranscriptItem =
				known &&
				(known.turnOutcome ||
					['completed', 'failed', 'cancelled'].includes(known.status)) &&
				(event.status === 'pending' || event.status === 'in_progress')
					? known
					: (() => {
							const reported = event.history?.outcome;
							const historyOutcome =
								reported === 'unknown' ||
								reported === 'completed' ||
								reported === 'failed' ||
								reported === 'interrupted'
									? reported
									: event.history === undefined
										? known?.historyOutcome
										: undefined;
							return {
								kind: 'tool',
								id: event.id,
								title: event.title ?? known?.title ?? event.id,
								status: event.status ?? known?.status ?? 'pending',
								...(historyOutcome ? {historyOutcome} : {}),
								...(known?.turnOutcome ? {turnOutcome: known.turnOutcome} : {}),
								...(event.toolKind || known?.toolKind
									? {toolKind: event.toolKind ?? known?.toolKind}
									: {}),
								...(event.details || known?.details
									? {details: {...known?.details, ...event.details}}
									: {}),
								...(known?.delegation || event.delegation
									? {delegation: known?.delegation ?? event.delegation}
									: {}),
								...(known?.approvalOnly || event.approvalOnly
									? {approvalOnly: true}
									: {}),
							};
						})();
			if (existingIndex !== undefined) {
				items[existingIndex] = nextTool;
			} else {
				cursor.toolIndex.set(event.id, items.length);
				items.push(nextTool);
			}
			return;
		}
		case 'plan':
			if (event.content === null) {
				const filtered = draft.items.filter(
					item => item.kind !== 'plan' || item.id !== event.id,
				);
				if (filtered.length !== draft.items.length) {
					draft.items = filtered;
					cursor.turnStart = undefined;
					cursor.toolIndex = null;
				}
				return;
			}
			upsert(
				mutableItems,
				draft.items,
				item => item.kind === 'plan' && item.id === event.id,
				() => ({
					kind: 'plan',
					id: event.id,
					content: event.content as StreamPlan,
				}),
			);
			return;
		case 'notice':
			mutableItems().push({
				kind: 'notice',
				severity: event.severity,
				title: event.title,
				...(event.description === undefined
					? {}
					: {description: event.description}),
			});
			return;
		case 'compaction':
		case 'compaction-chunk':
			upsert(
				mutableItems,
				draft.items,
				item => item.kind === 'compaction' && item.id === event.id,
				previous => {
					const known = previous?.kind === 'compaction' ? previous : undefined;
					return event.type === 'compaction-chunk'
						? {
								...known,
								kind: 'compaction',
								id: event.id,
								status: known?.status ?? 'in_progress',
								summary: (known?.summary ?? '') + event.text,
							}
						: {
								...known,
								kind: 'compaction',
								id: event.id,
								status: event.status,
								...(event.summary === undefined
									? {}
									: {summary: event.summary}),
								...(event.error === undefined ? {} : {error: event.error}),
							};
				},
			);
			return;
		case 'subagent':
			upsert(
				mutableItems,
				draft.items,
				item => item.kind === 'subagent' && item.id === event.id,
				previous => ({
					...(previous?.kind === 'subagent' ? previous : {}),
					kind: 'subagent',
					id: event.id,
					...(event.title === undefined ? {} : {title: event.title}),
					...(event.description === undefined
						? {}
						: {description: event.description}),
					...(event.state === undefined ? {} : {state: event.state}),
				}),
			);
			return;
		case 'session-message':
			upsert(
				mutableItems,
				draft.items,
				item => item.kind === 'session-message' && item.id === event.id,
				previous => {
					const known =
						previous?.kind === 'session-message' ? previous : undefined;
					return {
						...known,
						kind: 'session-message',
						id: event.id,
						text:
							event.text === undefined
								? (known?.text ?? '')
								: event.append
									? (known?.text ?? '') + event.text
									: event.text,
						...(event.sender === undefined ? {} : {sender: event.sender}),
						...(event.recipient === undefined
							? {}
							: {recipient: event.recipient}),
					};
				},
			);
			return;
		case 'permission':
			draft.permissions = [
				...draft.permissions.filter(request => request.id !== event.request.id),
				event.request,
			];
			return;
		case 'permission-closed':
			draft.permissions = draft.permissions.filter(
				request => request.id !== event.id,
			);
			return;
	}
}

function mergeMetadata(
	previous: StreamMetadata | undefined,
	next: StreamMetadata,
): StreamMetadata {
	return {
		...previous,
		...next,
		...(next.usage ? {usage: {...previous?.usage, ...next.usage}} : {}),
	};
}

function applyOne(
	draft: Transcript,
	mutableItems: () => TranscriptItem[],
	cursor: BatchCursor,
	event: TurnEvent,
	at: number | undefined,
): void {
	applyContent(draft, mutableItems, cursor, event, at);
	if (!event.metadata) return;
	const items = mutableItems();
	let index = -1;
	for (let pos = items.length - 1; pos >= 0; pos--) {
		const {kind} = items[pos];
		if (kind === 'user') break;
		if (kind === 'turn-metadata') {
			index = pos;
			break;
		}
		if (kind === 'agent' && index < 0) index = pos;
	}
	if (index < 0) {
		items.push({kind: 'turn-metadata', metadata: event.metadata});
		return;
	}
	const item = items[index];
	items[index] = {
		...item,
		metadata: mergeMetadata(item.metadata, event.metadata),
	};
}

export function applyEvent(
	transcript: Transcript,
	event: TurnEvent,
	at?: number,
): Transcript {
	return applyEvents(transcript, [event], at);
}

// A batch copies the list at most once, so its cost does not grow with each event.
export function applyEvents(
	transcript: Transcript,
	events: readonly TurnEvent[],
	at?: number,
): Transcript {
	if (events.length === 0) return transcript;
	const draft: Transcript = {...transcript};
	let copied = false;
	const cursor: BatchCursor = {turnStart: undefined, toolIndex: null};
	const mutableItems = () => {
		if (!copied || draft.items === transcript.items) {
			draft.items = [...draft.items];
			copied = true;
		}
		return draft.items;
	};
	for (const event of events) applyOne(draft, mutableItems, cursor, event, at);
	return draft;
}

function isMessage(item: TranscriptItem): item is Message {
	return item.kind === 'user' || item.kind === 'agent';
}

// A shared message id is the only proof of identity. Exact text counts only
// when neither side has an id, and empty agent text never counts.
function messageKey(item: Message): string | undefined {
	if (item.kind === 'agent' && item.text === '') return undefined;
	return item.messageId === undefined
		? `${item.kind}:text:${item.text}`
		: `${item.kind}:id:${item.messageId}`;
}

export function carryMessageRows(
	previous: Transcript,
	next: Transcript,
): Transcript {
	let changed = false;
	const items = next.items.map((item, index) => {
		const earlier = previous.items[index];
		if (
			(item.kind !== 'user' &&
				item.kind !== 'agent' &&
				item.kind !== 'thought') ||
			item.messageId
		)
			return item;
		const rowId =
			earlier?.kind === item.kind &&
			earlier.messageId === item.messageId &&
			earlier.text === item.text &&
			earlier.rowId
				? earlier.rowId
				: fallbackRowId('snapshot', index, item.text);
		if (item.rowId === rowId) return item;
		changed = true;
		return {...item, rowId};
	});
	return changed ? {...next, items} : next;
}

export function carryMessageTimes(
	previous: Transcript,
	next: Transcript,
	remembered?: ReadonlyMap<string, number>,
): Transcript {
	const singleTimes = new Map<string, number>();
	const useCompact = previous.items.length === 0 && remembered !== undefined;
	const keyOf = useCompact ? compactMessageKey : messageKey;
	if (!useCompact) {
		const counts = new Map<string, number>();
		for (const item of previous.items) {
			if (!isMessage(item)) continue;
			const key = messageKey(item);
			if (key === undefined) continue;
			const nextCount = (counts.get(key) ?? 0) + 1;
			counts.set(key, nextCount);
			if (nextCount === 1 && item.at !== undefined)
				singleTimes.set(key, item.at);
			else singleTimes.delete(key);
		}
	} else {
		for (const [key, at] of remembered) singleTimes.set(key, at);
	}
	if (singleTimes.size === 0) return next;
	let changed = false;
	const items = next.items.map(item => {
		if (!isMessage(item) || item.at !== undefined) return item;
		const key = keyOf(item);
		if (key === undefined) return item;
		const at = singleTimes.get(key);
		if (at === undefined) return item;
		// Only a single unused match carries a time, and then it is used up.
		singleTimes.delete(key);
		changed = true;
		return {...item, at};
	});
	return changed ? {...next, items} : next;
}
