import test from 'ava';
import {
	Children,
	createElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
	ThreadRecoveryNotice,
	type ThreadRecoveryNoticeProps,
} from '@/renderer/thread-recovery-notice';
import type {ThreadInfo} from '@/shared/ipc';
import {REPLAY_MISSING_REASON} from '@/shared/thread-replay';

const thread: ThreadInfo = {
	id: '11111111-1111-4111-8111-111111111111',
	projectId: '22222222-2222-4222-8222-222222222222',
	nanocoderSessionId: 'saved-session',
	title: '<script>manual fixture</script>',
	archiveState: 'active',
	runState: 'view-only',
	mode: 'normal',
	sessionCwd: '/fixture',
	lastActivityAt: '2026-01-02T00:00:00.000Z',
	viewOnlyReason: REPLAY_MISSING_REASON,
};
const props: ThreadRecoveryNoticeProps = {
	thread,
	pending: false,
	onRetry() {},
	onNew() {},
	onRemove() {},
};
const render = (next = props) =>
	renderToStaticMarkup(createElement(ThreadRecoveryNotice, next));

test('CHAT-09 view-only notice explains missing history and retains escaped desktop metadata and native recovery actions', t => {
	const html = render();
	t.true(html.includes('aria-label="view-only thread"'));
	t.true(html.includes('thread-view-only-notice'));
	t.true(html.includes('view-only'));
	t.true(html.includes('nanocoder can&#x27;t find this session'));
	t.true(html.includes('start a new thread in this project'));
	t.true(html.includes('remove from desktop'));
	t.true(html.includes('&lt;script&gt;manual fixture&lt;/script&gt;'));
	t.true(html.includes(`dateTime="${thread.lastActivityAt}"`));
	t.notRegex(html, /<script>/);
	t.false(html.includes('<textarea'));
	t.true(
		html.includes(
			'any messages still shown are held in memory in this window only',
		),
	);
	t.true(
		html.includes(
			'removing desktop metadata does not delete Nanocoder history',
		),
	);
	t.false(html.includes('retry this thread'));
	t.is((html.match(/<button/g) ?? []).length, 2);
});

test('retryable failure offers only explicit same-thread retry with its safe reason and no replacement-session action', t => {
	const html = render({
		...props,
		thread: {
			...thread,
			runState: 'failed',
			viewOnlyReason: '<script>safe resume refusal</script>',
		},
	});
	t.true(html.includes('aria-label="thread recovery"'));
	t.true(html.includes('retry this thread'));
	t.true(html.includes('&lt;script&gt;safe resume refusal&lt;/script&gt;'));
	t.false(html.includes('start a new thread'));
	t.false(html.includes('remove from desktop'));
	t.notRegex(html, /<script>/);
	t.is((html.match(/<button/g) ?? []).length, 1);
});

test('pending recovery actions are disabled with a visible reason and native button semantics', t => {
	for (const runState of ['view-only', 'failed'] as const) {
		const html = render({
			...props,
			thread: {...thread, runState},
			pending: true,
		});
		t.true(html.includes('waiting for the thread request or native dialog'));
		const buttons = html.match(/<button[^>]*>/g) ?? [];
		t.is(buttons.length, runState === 'view-only' ? 2 : 1);
		t.true(buttons.every(button => button.includes('disabled=""')));
		t.true(buttons.every(button => button.includes('type="button"')));
		t.false(html.includes('tabindex="-1"'));
	}
});

test('normal and interrupted states, unsaved threads and failures without a resume reason add no recovery notice', t => {
	for (const runState of ['new', 'ready', 'running', 'interrupted'] as const)
		t.is(render({...props, thread: {...thread, runState}}), '');
	t.is(render({...props, thread: {...thread, nanocoderSessionId: null}}), '');
	t.is(
		render({
			...props,
			thread: {...thread, runState: 'failed', viewOnlyReason: null},
		}),
		'',
	);
});

type Action = ReactElement<{
	children?: ReactNode;
	onClick?: () => void;
}>;
function actions(node: ReactNode): Action[] {
	return Children.toArray(node).flatMap(child =>
		isValidElement<Action['props']>(child)
			? [
					...(child.props.onClick ? [child] : []),
					...actions(child.props.children),
				]
			: [],
	);
}

test('recovery notices forward only their supplied callbacks and never start work during render', t => {
	const calls: string[] = [];
	const next = {
		...props,
		onRetry: () => calls.push('same-thread retry'),
		onNew: () => calls.push('metadata-only new'),
		onRemove: () => calls.push('metadata-only remove'),
	};
	const missing = ThreadRecoveryNotice(next);
	t.deepEqual(calls, []);
	for (const action of actions(missing)) action.props.onClick?.();
	t.deepEqual(calls, ['metadata-only new', 'metadata-only remove']);
	calls.length = 0;
	const retryable = ThreadRecoveryNotice({
		...next,
		thread: {...thread, runState: 'failed'},
	});
	t.deepEqual(calls, []);
	for (const action of actions(retryable)) action.props.onClick?.();
	t.deepEqual(calls, ['same-thread retry']);
});
