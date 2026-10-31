import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DialogApi, ThreadDialog} from '@/renderer/overlay-model';
import {projectTurnReason} from '@/renderer/thread-actions';
import {
	type ThreadDialogActions,
	type ThreadDialogData,
	ThreadDialogs,
} from '@/renderer/thread-dialogs';
import type {ThreadInfo} from '@/shared/ipc';

const thread: ThreadInfo = {
	id: 'fixture-thread',
	projectId: 'fixture-project',
	nanocoderSessionId: null,
	title: 'fixture thread',
	archiveState: 'active',
	runState: 'ready',
	lastActivityAt: '2026-10-29T00:00:00.000Z',
	sessionCwd: '/fixture/project',
	mode: 'normal',
	viewOnlyReason: null,
};

const actions: ThreadDialogActions = {
	create: async () => true,
	setDraft() {},
	open: async () => true,
	rename: async () => true,
	archive: async () => true,
	remove: async () => true,
	deleteHistory: async () => true,
};

const api: DialogApi = {
	open() {},
	close() {},
};

function render(
	request: ThreadDialog,
	overrides: Partial<ThreadDialogData> = {},
	threads: ThreadInfo[] = [thread],
) {
	const data: ThreadDialogData = {
		threads,
		projectId: 'fixture-project',
		projectName: 'tide',
		defaultMode: 'normal',
		pending: false,
		projectBusy: false,
		actions,
		...overrides,
	};
	return renderToStaticMarkup(
		createElement(ThreadDialogs, {request, data, api}),
	);
}

function count(html: string, text: string) {
	return html.split(text).length - 1;
}

test('thread menu lists the four actions and a short note when idle (E-30, E-32, E-34)', t => {
	const html = render({kind: 'thread-menu', threadId: thread.id});
	t.true(html.includes('thread actions'));
	t.true(html.includes('rename…'));
	t.true(html.includes('archive thread…'));
	t.true(html.includes('remove from desktop…'));
	t.true(html.includes('delete Nanocoder history…'));
	t.true(html.includes('thread-menu-item--danger'));
	t.true(html.includes('deleting history always needs its own confirmation.'));
	t.false(html.includes(projectTurnReason));
});

test('thread menu busy state shows the refusal once and disables every action (E-35)', t => {
	const html = render(
		{kind: 'thread-menu', threadId: thread.id},
		{projectBusy: true},
	);
	t.is(count(html, projectTurnReason), 1);
	t.is(count(html, 'disabled=""'), 4);
	t.false(html.includes('deleting history always needs its own confirmation.'));
});

test('rename shows the manual title precedence note and disables save for a busy project (E-22)', t => {
	const idle = render({kind: 'rename', threadId: thread.id});
	t.true(
		idle.includes('manual title takes precedence over later generated titles.'),
	);
	t.true(idle.includes('save title'));
	t.false(idle.includes('disabled=""'));
	const busy = render(
		{kind: 'rename', threadId: thread.id},
		{projectBusy: true},
	);
	t.true(busy.includes(projectTurnReason));
	t.true(busy.includes('disabled=""'));
});

test('archive confirmation holds initial focus on cancel and names the desktop-only effect (B1, E-02)', t => {
	const html = render({kind: 'archive', threadId: thread.id});
	t.true(html.includes('archive this thread?'));
	t.true(html.includes('moves the desktop row to archived threads.'));
	t.true(html.includes('does not change Nanocoder history.'));
	t.regex(html, /data-autofocus[^>]*>cancel</);
});

test('remove confirmation states that Nanocoder history stays put (B1, E-03)', t => {
	const html = render({kind: 'remove', threadId: thread.id});
	t.true(html.includes('remove this thread from desktop?'));
	t.true(html.includes('removes this thread'));
	t.true(html.includes('stays where it is.'));
	t.regex(html, /data-autofocus[^>]*>cancel</);
	t.true(html.includes('remove from desktop'));
});

test('new thread dialog uses the mockup copy and refuses without a project (D1, E-26)', t => {
	const html = render({kind: 'new-thread'});
	t.true(html.includes('new thread in tide'));
	t.true(
		html.includes(
			'the session will be created on the first send, not when you open this draft.',
		),
	);
	t.true(html.includes('what would you like to work on?'));
	t.true(
		html.includes(
			'project default · normal. yolo is never restored or used as a default.',
		),
	);
	t.true(html.includes('keep as new thread draft'));
	t.false(html.includes('select a project first'));

	const noProject = render({kind: 'new-thread'}, {projectId: null});
	t.true(noProject.includes('select a project first'));
	t.true(noProject.includes('disabled=""'));
});

test('other-thread notice names the running thread and offers both ways out (E-37)', t => {
	const running = {
		...thread,
		id: 'running-thread',
		runState: 'running' as const,
	};
	const html = render({kind: 'other-thread', threadId: running.id}, {}, [
		running,
	]);
	t.true(html.includes('another thread is running'));
	t.true(html.includes('you can read other threads while tide is running.'));
	t.true(html.includes('keep reading'));
	t.true(html.includes('return to active turn'));
	t.true(
		html.includes(
			'fixture thread · return there to cancel or answer its approval.',
		),
	);
});

test('stale dialog requests render nothing', t => {
	t.is(render({kind: 'rename', threadId: 'missing-thread'}), '');
	t.is(render({kind: 'other-thread', threadId: thread.id}), '');
});
