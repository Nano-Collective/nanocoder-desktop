import test from 'ava';
import {
	projectTurnReason,
	threadActionReason,
	threadMenuReasons,
} from '@/renderer/thread-actions';
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

test('a running project turn refuses thread metadata changes with one shared reason (E-35)', t => {
	t.is(threadActionReason(thread, false, true), projectTurnReason);
	t.is(threadActionReason(thread, false, false), undefined);
	t.is(
		threadActionReason({...thread, runState: 'running'}, false, false),
		'wait for this thread to finish',
	);
	t.is(
		threadActionReason(thread, true, false),
		'another thread request is pending',
	);
	t.is(
		threadActionReason(null, false, false),
		'select a thread in this project',
	);
});

test('thread menu refusals share the busy reason and keep history deletion native (E-32, E-33)', t => {
	const reasons = threadMenuReasons(thread, {
		pending: false,
		projectBusy: true,
		renameDisabledReason: undefined,
		deleteHistoryDisabledReason: undefined,
	});
	t.is(reasons.shared, projectTurnReason);
	t.is(reasons.rename, projectTurnReason);
	t.is(reasons.archive, projectTurnReason);
	t.is(reasons.remove, projectTurnReason);
	t.is(reasons.deleteHistory, projectTurnReason);
});

test('thread menu asks for a Nanocoder session before rename and history deletion', t => {
	const reasons = threadMenuReasons(thread, {
		pending: false,
		projectBusy: false,
		renameDisabledReason: 'Nanocoder did not confirm rename',
		deleteHistoryDisabledReason: 'Nanocoder did not confirm delete',
	});
	t.is(reasons.shared, undefined);
	t.is(reasons.archive, undefined);
	t.is(reasons.remove, undefined);
	t.is(reasons.rename, undefined);
	t.is(reasons.deleteHistory, 'this thread has no Nanocoder history');

	const withSession = threadMenuReasons(
		{...thread, nanocoderSessionId: 'session-1'},
		{
			pending: false,
			projectBusy: false,
			renameDisabledReason: 'Nanocoder did not confirm rename',
			deleteHistoryDisabledReason: 'Nanocoder did not confirm delete',
		},
	);
	t.is(withSession.rename, 'Nanocoder did not confirm rename');
	t.is(withSession.deleteHistory, 'Nanocoder did not confirm delete');
});
