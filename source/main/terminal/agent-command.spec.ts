import test from 'ava';
import {AgentCommandObserver} from '@/main/terminal/agent-command';
import type {ProjectEvent, TurnEvent} from '@/shared/ipc';
import type {AgentCommandInfo} from '@/shared/terminal';

function fixture() {
	const updates: AgentCommandInfo[] = [];
	const observer = new AgentCommandObserver((_id, info) =>
		updates.push({...info}),
	);
	observer.reset('project');
	const event = (events: TurnEvent[]): ProjectEvent => ({
		type: 'turn',
		projectId: 'project',
		threadId: 'thread',
		sequence: 1,
		events,
	});
	const permission: TurnEvent = {
		type: 'permission',
		request: {
			id: 'request',
			title: 'execute_bash: npm test',
			options: [
				{id: 'yes', name: 'allow', kind: 'allow_once'},
				{id: 'no', name: 'deny', kind: 'reject_once'},
			],
		},
	};
	return {observer, updates, event, permission};
}

test('TERM-12 only explicit execute_bash labels populate the passive command strip', t => {
	const f = fixture();
	f.observer.observe(
		f.event([{type: 'tool', id: 'other', title: 'write_file: private'}]),
	);
	t.is(f.updates.length, 0);
	f.observer.observe(
		f.event([{type: 'tool', id: 'shell', title: 'execute_bash: npm test'}]),
	);
	t.deepEqual(f.updates.at(-1), {
		threadId: 'thread',
		command: 'npm test',
		approval: 'unknown',
	});
	f.observer.observe(f.event([f.permission]));
	t.is(f.updates.at(-1)?.approval, 'pending');
	const accepted = f.observer.capture({
		projectId: 'project',
		threadId: 'thread',
		requestId: 'request',
		optionId: 'yes',
	});
	f.observer.observe(f.event([{type: 'permission-closed', id: 'request'}]));
	t.is(f.updates.at(-1)?.approval, 'unknown');
	accepted?.();
	t.is(f.updates.at(-1)?.approval, 'allowed');
});

test('TERM-12 rejected, stale, replayed or unoffered answers never claim approval', t => {
	const f = fixture();
	f.observer.observe({...f.event([f.permission]), projectId: 'other'});
	t.is(f.updates.length, 0);
	f.observer.observe({
		...f.event([f.permission]),
		replay: {epoch: 'epoch', phase: 'complete'},
	} as ProjectEvent);
	t.is(f.updates.length, 0);
	f.observer.observe(f.event([f.permission]));
	t.is(
		f.observer.capture({
			projectId: 'project',
			threadId: 'thread',
			requestId: 'request',
			optionId: 'invented',
		}),
		undefined,
	);
	const rejected = f.observer.capture({
		projectId: 'project',
		threadId: 'thread',
		requestId: 'request',
		optionId: 'no',
	});
	rejected?.();
	t.is(f.updates.at(-1)?.approval, 'rejected');
	f.observer.reset('other');
	const count = f.updates.length;
	rejected?.();
	t.is(f.updates.length, count);
});
