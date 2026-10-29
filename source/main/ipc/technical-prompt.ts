import type {NanocoderTurnResult} from '@/main/nanocoder/acp-client';
import type {TurnEvent, TurnResult} from '@/shared/ipc';

export interface TechnicalPromptOwner {
	projectId: string | null;
	sessionId: string | null;
}

export function completeTechnicalPrompt(
	result: NanocoderTurnResult,
	requested: TechnicalPromptOwner,
	active: TechnicalPromptOwner,
	publish: (event: TurnEvent) => void,
): TurnResult {
	if (
		result.metadata &&
		requested.projectId &&
		requested.sessionId &&
		requested.projectId === active.projectId &&
		requested.sessionId === active.sessionId
	) {
		publish({type: 'metadata', metadata: result.metadata});
	}
	return {stopReason: result.stopReason};
}
