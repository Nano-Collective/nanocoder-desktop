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
	| {kind: 'user' | 'agent' | 'thought'; text: string; messageId?: string}
	| {kind: 'failure'; text: string}
	| {
			kind: 'tool';
			id: string;
			title: string;
			status: string;
			toolKind?: string;
			details?: StreamToolDetails;
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
	metadata?: StreamMetadata;
}

export const emptyTranscript: Transcript = {items: [], permissions: []};

export function addUserMessage(
	transcript: Transcript,
	text: string,
): Transcript {
	return {...transcript, items: [...transcript.items, {kind: 'user', text}]};
}

function upsert(
	transcript: Transcript,
	matches: (item: TranscriptItem) => boolean,
	update: (previous?: TranscriptItem) => TranscriptItem,
): Transcript {
	const index = transcript.items.findIndex(matches);
	const items = [...transcript.items];
	if (index < 0) items.push(update());
	else items[index] = update(items[index]);
	return {...transcript, items};
}

function applyContent(transcript: Transcript, event: TurnEvent): Transcript {
	const {items} = transcript;
	switch (event.type) {
		case 'metadata':
			return transcript;
		case 'commands':
			return {...transcript, commands: event.commands};
		case 'mode':
			return {...transcript, mode: event.id};
		case 'config':
			return {...transcript, config: event.options};
		case 'context':
			return {
				...transcript,
				context: {
					used: event.used,
					size: event.size,
					...(event.cost ? {cost: event.cost} : {}),
				},
			};
		case 'user':
		case 'text':
		case 'thought': {
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
						...(event.messageId ? {messageId: event.messageId} : {}),
					};
			return {
				...transcript,
				items: join ? [...items.slice(0, -1), item] : [...items, item],
			};
		}
		case 'tool':
			return upsert(
				transcript,
				item => item.kind === 'tool' && item.id === event.id,
				previous => {
					const known = previous?.kind === 'tool' ? previous : undefined;
					return {
						kind: 'tool',
						id: event.id,
						title: event.title ?? known?.title ?? event.id,
						status: event.status ?? known?.status ?? 'pending',
						...(event.toolKind || known?.toolKind
							? {toolKind: event.toolKind ?? known?.toolKind}
							: {}),
						...(event.details || known?.details
							? {details: {...known?.details, ...event.details}}
							: {}),
					};
				},
			);
		case 'plan':
			if (event.content === null)
				return {
					...transcript,
					items: items.filter(
						item => item.kind !== 'plan' || item.id !== event.id,
					),
				};
			return upsert(
				transcript,
				item => item.kind === 'plan' && item.id === event.id,
				() => ({
					kind: 'plan',
					id: event.id,
					content: event.content as StreamPlan,
				}),
			);
		case 'notice':
			return {
				...transcript,
				items: [
					...items,
					{
						kind: 'notice',
						severity: event.severity,
						title: event.title,
						...(event.description === undefined
							? {}
							: {description: event.description}),
					},
				],
			};
		case 'compaction':
		case 'compaction-chunk':
			return upsert(
				transcript,
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
		case 'subagent':
			return upsert(
				transcript,
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
		case 'session-message':
			return upsert(
				transcript,
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
		case 'permission':
			return {
				...transcript,
				permissions: [
					...transcript.permissions.filter(
						request => request.id !== event.request.id,
					),
					event.request,
				],
			};
		case 'permission-closed':
			return {
				...transcript,
				permissions: transcript.permissions.filter(
					request => request.id !== event.id,
				),
			};
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

export function applyEvent(
	transcript: Transcript,
	event: TurnEvent,
): Transcript {
	const next = applyContent(transcript, event);
	if (!event.metadata) return next;
	let index = next.items.length - 1;
	while (index >= 0 && next.items[index].kind !== 'agent') index--;
	if (index < 0)
		return {...next, metadata: mergeMetadata(next.metadata, event.metadata)};
	const items = [...next.items];
	const item = items[index];
	items[index] = {
		...item,
		metadata: mergeMetadata(item.metadata, event.metadata),
	};
	return {...next, items};
}

export function applyEvents(
	transcript: Transcript,
	events: readonly TurnEvent[],
): Transcript {
	return events.reduce(applyEvent, transcript);
}
