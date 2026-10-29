import test from 'ava';
import {completeTechnicalPrompt} from '@/main/ipc/technical-prompt';
import type {TurnEvent} from '@/shared/ipc';

const owner = {projectId: 'project', sessionId: 'session'};
const result = {
	stopReason: 'end_turn' as const,
	metadata: {usage: {totalTokens: 20}},
};

test('technical prompt publishes reported metadata as an event, never an IPC return field (CHAT-19)', t => {
	const published: TurnEvent[] = [];
	t.deepEqual(
		completeTechnicalPrompt(result, owner, owner, event =>
			published.push(event),
		),
		{stopReason: 'end_turn'},
	);
	t.deepEqual(published, [
		{type: 'metadata', metadata: {usage: {totalTokens: 20}}},
	]);
});

test('usage from an in-flight prompt never reaches a switched project or session (CHAT-19)', t => {
	for (const active of [
		{projectId: 'other', sessionId: 'session'},
		{projectId: 'project', sessionId: 'other'},
		{projectId: null, sessionId: null},
	]) {
		const published: TurnEvent[] = [];
		t.deepEqual(
			completeTechnicalPrompt(result, owner, active, event =>
				published.push(event),
			),
			{stopReason: 'end_turn'},
		);
		t.deepEqual(published, []);
	}
});
