import type {PermissionRequestInfo, TurnEvent} from '@/shared/ipc';

export type TranscriptItem =
	| {kind: 'user'; text: string}
	| {kind: 'agent'; text: string}
	| {kind: 'tool'; id: string; title: string; status: string};

export interface Transcript {
	items: TranscriptItem[];
	// Every request still waiting for an answer, oldest first.
	permissions: PermissionRequestInfo[];
}

export const emptyTranscript: Transcript = {items: [], permissions: []};

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
