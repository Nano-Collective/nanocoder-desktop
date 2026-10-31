import test from 'ava';
import {createElement, Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Composer, type ComposerProps} from '@/renderer/composer';
import {threadComposerState} from '@/renderer/thread-composer-state';
import {ThreadRecoveryNotice} from '@/renderer/thread-recovery-notice';
import type {ThreadInfo} from '@/shared/ipc';
import {REPLAY_MISSING_REASON} from '@/shared/thread-replay';

const thread: ThreadInfo = {
	id: '11111111-1111-4111-8111-111111111111',
	projectId: '22222222-2222-4222-8222-222222222222',
	nanocoderSessionId: 'saved-session',
	title: 'fixture',
	archiveState: 'active',
	runState: 'failed',
	mode: 'normal',
	sessionCwd: '/fixture',
	lastActivityAt: '2026-01-02T00:00:00.000Z',
	viewOnlyReason: 'safe retryable resume refusal',
};
const context = {
	thread,
	accepting: false,
	replay: 'failed' as const,
	pending: false,
};

test('CHAT-09 retryable failure with a reason keeps the App draft editable while only view-only hides it', t => {
	t.deepEqual(threadComposerState(context), {visible: true, editable: true});
	t.deepEqual(
		threadComposerState({
			...context,
			thread: {...thread, viewOnlyReason: null},
		}),
		{visible: true, editable: true},
	);
	for (const viewOnlyReason of [null, 'safe reason', REPLAY_MISSING_REASON])
		t.deepEqual(
			threadComposerState({
				...context,
				thread: {...thread, runState: 'view-only', viewOnlyReason},
			}),
			{visible: false, editable: false},
		);
});

test('App composer presentation preserves process, pending, replay and archive draft rules independently of reasons', t => {
	t.deepEqual(threadComposerState({...context, thread: null}), {
		visible: false,
		editable: false,
	});
	t.deepEqual(threadComposerState({...context, replay: undefined}), {
		visible: true,
		editable: false,
	});
	t.deepEqual(
		threadComposerState({...context, replay: undefined, accepting: true}),
		{visible: true, editable: true},
	);
	t.deepEqual(
		threadComposerState({
			...context,
			replay: undefined,
			accepting: true,
			pending: true,
		}),
		{visible: true, editable: false},
	);
	t.deepEqual(
		threadComposerState({...context, replay: 'replaying', pending: true}),
		{visible: true, editable: true},
	);
	t.deepEqual(
		threadComposerState({
			...context,
			thread: {...thread, archiveState: 'archived'},
		}),
		{visible: true, editable: false},
	);
});

test('App failed-with-reason props render an enabled retained textarea and retry while send and controls remain refused', t => {
	const calls: string[] = [];
	const state = threadComposerState(context);
	const composer: ComposerProps = {
		draft: 'unsent memory-only draft',
		editable: state.editable,
		sendReason: thread.viewOnlyReason,
		controlReason: thread.viewOnlyReason,
		projectName: 'fixture',
		projectControls: null,
		mode: 'normal',
		defaultMode: 'normal',
		modePending: false,
		running: false,
		stopping: false,
		commands: [],
		onDraft: () => calls.push('edit'),
		onSend: () => calls.push('send'),
		onCancel: () => calls.push('cancel'),
		onMode: () => calls.push('mode'),
		onDefault: () => calls.push('default'),
		onConfig: () => calls.push('config'),
	};
	const html = renderToStaticMarkup(
		createElement(
			Fragment,
			null,
			state.visible && createElement(Composer, composer),
			createElement(ThreadRecoveryNotice, {
				thread,
				pending: false,
				onRetry: () => calls.push('retry'),
				onNew: () => calls.push('new'),
				onRemove: () => calls.push('remove'),
			}),
		),
	);
	const textarea = html.match(/<textarea[^>]*>/)?.[0];
	t.truthy(textarea);
	t.false(textarea?.includes('disabled'));
	t.true(html.includes('unsent memory-only draft</textarea>'));
	t.true(html.includes('retry this thread'));
	t.true(html.includes(thread.viewOnlyReason ?? ''));
	const send = html.match(/<button[^>]*aria-label="send"[^>]*>/)?.[0];
	t.truthy(send);
	t.true(send?.includes('disabled'));
	t.true(
		(html.match(/<select[^>]*>/g) ?? []).every(tag => tag.includes('disabled')),
	);
	t.deepEqual(calls, []);
});
