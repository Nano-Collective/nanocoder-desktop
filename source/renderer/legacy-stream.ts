import type {TurnEvent} from '@/shared/ipc';

export function legacyMetadataEvent(event: TurnEvent): TurnEvent | undefined {
	return event.type === 'metadata' ? event : undefined;
}
