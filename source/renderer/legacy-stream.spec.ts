import test from 'ava';
import {legacyMetadataEvent} from '@/renderer/legacy-stream';
import {applyEvents, emptyTranscript} from '@/renderer/transcript';
import type {TurnEvent} from '@/shared/ipc';

test('duplicate non-metadata legacy events leave the transcript unchanged (CHAT-05)', t => {
	const before = applyEvents(emptyTranscript, [{type: 'text', text: 'one'}]);
	for (const event of [
		{type: 'text', text: 'one'},
		{type: 'thought', text: 'thought'},
		{type: 'commands', commands: []},
		{type: 'permission-closed', id: 'request'},
	] satisfies TurnEvent[]) {
		const legacy = legacyMetadataEvent(event);
		t.is(applyEvents(before, legacy ? [legacy] : []), before);
	}
});

test('the temporary legacy path accepts only metadata (CHAT-19)', t => {
	const event: TurnEvent = {
		type: 'metadata',
		metadata: {usage: {totalTokens: 20}},
	};
	t.is(legacyMetadataEvent(event), event);
});
