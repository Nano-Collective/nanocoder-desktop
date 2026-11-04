import test from 'ava';
import {ProjectActivityTracker} from '@/main/threads/project-activity';
import type {
	ProjectActivityStatus,
	ProjectEvent,
	ThreadInfo,
	ThreadRunState,
} from '@/shared/ipc';

function fixture(active: string | undefined = 'a') {
	const published: Array<[string, ProjectActivityStatus]> = [];
	let current: string | undefined = active;
	const tracker = new ProjectActivityTracker({
		active: () => current,
		publish: (projectId, status) => published.push([projectId, status]),
	});
	let sequence = 0;
	const thread = (
		projectId: string,
		id: string,
		runState: ThreadRunState,
	): ProjectEvent => {
		sequence += 1;
		return {
			type: 'thread',
			projectId,
			sequence,
			thread: {id, projectId, runState} as ThreadInfo,
		};
	};
	return {
		tracker,
		published,
		thread,
		setActive: (projectId: string | undefined) => {
			current = projectId;
		},
	};
}

test('CHAT-22 a running turn and a turn waiting for approval are published, and approval wins', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('b', '2', 'waiting-approval'));
	f.tracker.observe(f.thread('b', '2', 'running'));
	t.deepEqual(f.published, [
		['b', 'running'],
		['b', 'needs-approval'],
		['b', 'running'],
	]);
});

test('CHAT-22 a turn that finishes in the background leaves a finished marker until the project is opened', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('b', '1', 'ready'));
	t.deepEqual(f.published.at(-1), ['b', 'finished']);
	f.tracker.activate('b');
	t.deepEqual(f.published.at(-1), ['b', 'idle']);
});

test('CHAT-22 a failed or interrupted background turn is marked failed', t => {
	for (const state of ['failed', 'interrupted'] as const) {
		const f = fixture();
		f.tracker.observe(f.thread('b', '1', 'running'));
		f.tracker.observe(f.thread('b', '1', state));
		t.deepEqual(f.published.at(-1), ['b', 'failed']);
	}
});

test('CHAT-22 a turn that ends in the project being viewed leaves no marker', t => {
	const f = fixture('a');
	f.tracker.observe(f.thread('a', '1', 'running'));
	f.tracker.observe(f.thread('a', '1', 'ready'));
	t.deepEqual(f.published, [
		['a', 'running'],
		['a', 'idle'],
	]);
});

test('CHAT-22 a status is published only when it changes', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('b', '1', 'running'));
	t.deepEqual(f.published, [['b', 'running']]);
});

test('CHAT-22 several threads combine: any approval wins, then running', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('b', '2', 'running'));
	f.tracker.observe(f.thread('b', '1', 'ready'));
	t.deepEqual(f.published.at(-1), ['b', 'running']);
	f.tracker.observe(f.thread('b', '2', 'ready'));
	t.deepEqual(f.published.at(-1), ['b', 'finished']);
});

test('CHAT-22 removing a thread or a project drops its activity', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe({
		type: 'thread-removed',
		projectId: 'b',
		threadId: '1',
		sequence: 9,
	});
	t.deepEqual(f.published.at(-1), ['b', 'idle']);
	f.tracker.observe(f.thread('c', '1', 'running'));
	f.tracker.observe({type: 'project-removed', projectId: 'c', sequence: 10});
	t.deepEqual(f.published.at(-1), ['c', 'idle']);
	t.deepEqual(f.tracker.unfinished(), []);
});

test('CHAT-22 unfinished lists projects with a running or waiting turn, in any project', t => {
	const f = fixture('a');
	f.tracker.observe(f.thread('a', '1', 'running'));
	f.tracker.observe(f.thread('b', '1', 'waiting-approval'));
	f.tracker.observe(f.thread('c', '1', 'running'));
	f.tracker.observe(f.thread('c', '1', 'ready'));
	t.deepEqual(f.tracker.unfinished().sort(), ['a', 'b']);
});

test('CHAT-22 republish repeats only what needs attention, and reset clears everything', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('c', '1', 'running'));
	f.tracker.observe(f.thread('c', '1', 'ready'));
	f.tracker.observe(f.thread('d', '1', 'view-only'));
	f.published.length = 0;
	f.tracker.republish();
	t.deepEqual(f.published.sort(), [
		['b', 'running'],
		['c', 'finished'],
	]);
	f.published.length = 0;
	f.tracker.reset();
	t.deepEqual(f.published.sort(), [
		['b', 'idle'],
		['c', 'idle'],
	]);
	t.deepEqual(f.tracker.unfinished(), []);
});

test('CHAT-22 listeners hear each change with the previous status, and can stop listening', t => {
	const f = fixture();
	const heard: string[] = [];
	const stop = f.tracker.onChange(change =>
		heard.push(`${change.projectId}:${change.previous}>${change.status}`),
	);
	f.tracker.observe(f.thread('b', '1', 'running'));
	f.tracker.observe(f.thread('b', '1', 'waiting-approval'));
	stop();
	f.tracker.observe(f.thread('b', '1', 'ready'));
	t.deepEqual(heard, ['b:idle>running', 'b:running>needs-approval']);
});

test('CHAT-22 a thread that was never running adds no marker when it settles', t => {
	const f = fixture();
	f.tracker.observe(f.thread('b', '1', 'new'));
	f.tracker.observe(f.thread('b', '1', 'ready'));
	t.deepEqual(f.published, []);
});
