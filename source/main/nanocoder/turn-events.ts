import type {SessionNotification} from '@agentclientprotocol/sdk';
import type {TurnEvent} from '@/shared/ipc';

// Anything the desktop does not show yet is dropped, never guessed at.
export function toTurnEvent(
	update: SessionNotification['update'],
): TurnEvent | undefined {
	switch (update.sessionUpdate) {
		case 'agent_message_chunk':
			return update.content.type === 'text'
				? {type: 'text', text: update.content.text}
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
