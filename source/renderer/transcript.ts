import type {PermissionRequestInfo, TurnEvent} from '@/shared/ipc';

export type TranscriptItem =
	| {kind: 'user'; text: string}
	| {kind: 'agent'; text: string}
	| {kind: 'tool'; id: string; title: string; status: string};

export interface Transcript {
	items: TranscriptItem[];
	permission: PermissionRequestInfo | null;
}

export const emptyTranscript: Transcript = {items: [], permission: null};

export function addUserMessage(
	transcript: Transcript,
	text: string,
): Transcript {
	return {...transcript, items: [...transcript.items, {kind: 'user', text}]};
}

export function applyEvent(
	transcript: Transcript,
	event: TurnEvent,
): Transcript {
	const {items} = transcript;
	switch (event.type) {
		case 'text': {
			const last = items.at(-1);
			return {
				...transcript,
				items:
					last?.kind === 'agent'
						? [
								...items.slice(0, -1),
								{kind: 'agent', text: last.text + event.text},
							]
						: [...items, {kind: 'agent', text: event.text}],
			};
		}
		case 'tool': {
			const known = items.some(
				item => item.kind === 'tool' && item.id === event.id,
			);
			return {
				...transcript,
				items: known
					? items.map(item =>
							item.kind === 'tool' && item.id === event.id
								? {
										...item,
										title: event.title ?? item.title,
										status: event.status ?? item.status,
									}
								: item,
						)
					: [
							...items,
							{
								kind: 'tool',
								id: event.id,
								title: event.title ?? event.id,
								status: event.status ?? 'pending',
							},
						],
			};
		}
		case 'permission':
			return {...transcript, permission: event.request};
		case 'permission-closed':
			return transcript.permission?.id === event.id
				? {...transcript, permission: null}
				: transcript;
	}
}
