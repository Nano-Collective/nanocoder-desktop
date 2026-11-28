import type {
	PermissionRequestInfo,
	StreamCommand,
	StreamConfigOption,
	StreamMetadata,
	StreamPlan,
	StreamToolDetails,
	TurnEvent,
} from '@/shared/ipc';

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
	| {kind: 'failure'; text: string; rowId?: string}
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

// A failure belongs to the turn that was current when it was recorded.
export function appendFailure(
	transcript: Transcript,
	text: string,
): Transcript {
	const turns = transcript.items.filter(item => item.kind === 'user').length;
	const failures = transcript.items.filter(
		item => item.kind === 'failure',
	).length;
	return {
		...transcript,
		items: [
			...transcript.items,
			{kind: 'failure', text, rowId: `${turns}:${failures}`},
		],
	};
}

// One variant covers both user and agent text, so Extract matches on both kinds.
type UserItem = Extract<TranscriptItem, {kind: 'user' | 'agent'}>;

function sameTurnUser(
	a: UserItem | undefined,
	b: UserItem | undefined,
): boolean {
	if (!a || !b) return false;
	if (a.messageId !== undefined || b.messageId !== undefined)
		return a.messageId === b.messageId;
	return a.text === b.text;
}

// Re-inserts each failure after the turn that failed (before the next user
// message), so a snapshot keeps it beside its turn. Failures whose turn no
// longer matches go last.
export function carryFailureRows(
	previous: Transcript,
	next: Transcript,
): Transcript {
	const failures = new Map<
		number,
		{anchor?: UserItem; rows: TranscriptItem[]}
	>();
	let turns = 0;
	let currentUser: UserItem | undefined;
	for (const item of previous.items) {
		if (item.kind === 'user') {
			turns++;
			currentUser = item;
		} else if (item.kind === 'failure') {
			const group = failures.get(turns);
			if (group) group.rows.push(item);
			else failures.set(turns, {anchor: currentUser, rows: [item]});
		}
	}
	if (failures.size === 0) return next;
	const placed = new Set<number>();
	const items: TranscriptItem[] = [];
	let seen = 0;
	let seenUser: UserItem | undefined;
	for (const item of next.items) {
		if (item.kind === 'user') {
			const group = failures.get(seen);
			if (group && (seen === 0 || sameTurnUser(group.anchor, seenUser))) {
				items.push(...group.rows);
				placed.add(seen);
			}
			seen++;
			seenUser = item;
		}
		items.push(item);
	}
	for (const [turn, group] of failures) {
		if (!placed.has(turn)) items.push(...group.rows);
	}
	return {...next, items};
}

// Each batch copies the list at most once, lazily on the first item write.
function upsert(
	mutableItems: () => TranscriptItem[],
	readItems: readonly TranscriptItem[],
	matches: (item: TranscriptItem) => boolean,
	update: (previous?: TranscriptItem) => TranscriptItem,
	floor = -1,
): void {
	let index = readItems.length - 1;
	while (index > floor && !matches(readItems[index])) index--;
	const items = mutableItems();
	if (index > floor) items[index] = update(items[index]);
	else items.push(update());
}

function applyContent(
	draft: Transcript,
	mutableItems: () => TranscriptItem[],
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
			return;
		}
		case 'tool':
			upsert(
				mutableItems,
				draft.items,
				item => item.kind === 'tool' && item.id === event.id,
				previous => {
					const known = previous?.kind === 'tool' ? previous : undefined;
					if (
						known &&
						(known.turnOutcome ||
							['completed', 'failed', 'cancelled'].includes(known.status)) &&
						(event.status === 'pending' || event.status === 'in_progress')
					)
						return known;
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
				},
				currentTurnStart(draft.items),
			);
			return;
		case 'plan':
			if (event.content === null) {
				const filtered = draft.items.filter(
					item => item.kind !== 'plan' || item.id !== event.id,
				);
				if (filtered.length !== draft.items.length) draft.items = filtered;
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
	event: TurnEvent,
	at: number | undefined,
): void {
	applyContent(draft, mutableItems, event, at);
	if (!event.metadata) return;
	const items = mutableItems();
	let index = -1;
	for (let cursor = items.length - 1; cursor >= 0; cursor--) {
		const {kind} = items[cursor];
		if (kind === 'user') break;
		if (kind === 'turn-metadata') {
			index = cursor;
			break;
		}
		if (kind === 'agent' && index < 0) index = cursor;
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
	const mutableItems = () => {
		if (!copied || draft.items === transcript.items) {
			draft.items = [...draft.items];
			copied = true;
		}
		return draft.items;
	};
	for (const event of events) applyOne(draft, mutableItems, event, at);
	return draft;
}

type Message = Extract<TranscriptItem, {kind: 'user' | 'agent'}>;

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
): Transcript {
	const earlier = new Map<string, Message[]>();
	for (const item of previous.items) {
		if (!isMessage(item)) continue;
		const key = messageKey(item);
		if (key === undefined) continue;
		const bucket = earlier.get(key);
		if (bucket) bucket.push(item);
		else earlier.set(key, [item]);
	}
	let changed = false;
	const items = next.items.map(item => {
		if (!isMessage(item) || item.at !== undefined) return item;
		const key = messageKey(item);
		const matches = key === undefined ? [] : (earlier.get(key) ?? []);
		// Only a single unused match carries a time, and then it is used up.
		if (key === undefined || matches.length !== 1) return item;
		earlier.delete(key);
		const [match] = matches;
		if (match.at === undefined) return item;
		changed = true;
		return {...item, at: match.at};
	});
	return changed ? {...next, items} : next;
}
