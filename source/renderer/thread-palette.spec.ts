import test from 'ava';
import {runAction} from '@/renderer/overlay-model';
import {threadPalette} from '@/renderer/thread-palette';
import type {ThreadInfo} from '@/shared/ipc';

const thread: ThreadInfo = {
	id: '22222222-2222-4222-8222-222222222222',
	projectId: '11111111-1111-4111-8111-111111111111',
	nanocoderSessionId: null,
	title: 'fixture thread',
	archiveState: 'active',
	runState: 'new',
	lastActivityAt: '2026-10-29T00:00:00.000Z',
	sessionCwd: '/fixture/project',
	mode: 'normal',
	viewOnlyReason: null,
};

function fixture(overrides: Partial<Parameters<typeof threadPalette>[0]> = {}) {
	const calls: unknown[] = [];
	const actions = threadPalette({
		projectId: thread.projectId,
		thread,
		pending: false,
		onNew: projectId => {
			calls.push(['new', projectId]);
		},
		onRename: threadId => {
			calls.push(['rename', threadId]);
		},
		onArchive: (threadId, archived) => {
			calls.push(['archive', threadId, archived]);
		},
		...overrides,
	});
	return {actions, calls};
}

test('thread palette exposes the actual new rename and archive callbacks (CHAT-03, CHAT-12, CHAT-13)', t => {
	const {actions, calls} = fixture();
	t.deepEqual(
		actions.map(action => action.label),
		['new thread', 'rename thread', 'archive thread'],
	);
	for (const action of actions) t.true(runAction(action));
	t.deepEqual(calls, [
		['new', thread.projectId],
		['rename', thread.id],
		['archive', thread.id, true],
	]);
});

test('unavailable thread palette actions give reasons and never invoke their callbacks (CHAT-03, CHAT-12, CHAT-13)', t => {
	for (const [overrides, enabled] of [
		[{projectId: null}, [false, false, false]],
		[{thread: null}, [true, false, false]],
		[{thread: {...thread, projectId: 'other-project'}}, [true, false, false]],
		[{pending: true}, [false, false, false]],
		[{thread: {...thread, runState: 'running'}}, [true, false, false]],
		[{thread: {...thread, runState: 'waiting-approval'}}, [true, false, false]],
		[
			{renameDisabledReason: 'Nanocoder did not confirm rename'},
			[true, false, true],
		],
	] as const) {
		const {actions, calls} = fixture(overrides);
		t.is(actions.length, 3);
		for (const [index, action] of actions.entries()) {
			const previous = [...calls];
			t.is(runAction(action), enabled[index]);
			if (!enabled[index]) {
				t.truthy(action.disabledReason);
				t.deepEqual(calls, previous);
			}
		}
	}
});

test('archived thread palette command unarchives the selected thread (CHAT-13)', t => {
	const {actions, calls} = fixture({
		thread: {...thread, archiveState: 'archived'},
	});
	t.is(actions[2]?.label, 'unarchive thread');
	t.true(runAction(actions[2]));
	t.deepEqual(calls, [['archive', thread.id, false]]);
});

test('rename passes the palette opener through without treating it as thread authority', t => {
	const opener = {isConnected: true, focus() {}};
	let received: unknown;
	const {actions} = fixture({
		onRename: (id, originalFocus) => {
			received = {id, originalFocus};
		},
	});
	t.true(runAction(actions[1], opener));
	t.deepEqual(received, {id: thread.id, originalFocus: opener});
});
