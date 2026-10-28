import type {SessionNotification} from '@agentclientprotocol/sdk';
import type {TurnEvent} from '@/shared/ipc';

// Nanocoder ends a replay with an empty chunk that only carries metadata.
const hasText = (content: {
	type: string;
	text?: string;
}): content is {
	type: 'text';
	text: string;
} => content.type === 'text' && !!content.text;

// Anything the desktop does not show yet is dropped, never guessed at.
// The user's own message is shown when it is sent, so a live update never maps it;
// only a resume's replay does (`history`).
export function toTurnEvent(
	update: SessionNotification['update'],
	{history = false}: {history?: boolean} = {},
): TurnEvent | undefined {
	switch (update.sessionUpdate) {
		case 'agent_message_chunk':
			return hasText(update.content)
				? {type: 'text', text: update.content.text}
				: undefined;
		case 'user_message_chunk':
			return history && hasText(update.content)
				? {type: 'user', text: update.content.text}
				: undefined;
		case 'tool_call':
			return {
				type: 'tool',
				id: update.toolCallId,
				title: update.title,
				status: update.status ?? 'pending',
			};
		case 'tool_call_update':
			return {
				type: 'tool',
				id: update.toolCallId,
				title: update.title ?? undefined,
				status: update.status ?? undefined,
			};
		default:
			return undefined;
	}
}
