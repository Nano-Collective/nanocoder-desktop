import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppShell} from '@/renderer/app-shell';
import {ThreadRail} from '@/renderer/thread-rail';
import type {ThreadInfo} from '@/shared/ipc';

const thread: ThreadInfo = {
	id: 'fixture-thread',
	projectId: 'fixture-project',
	nanocoderSessionId: null,
	title: 'fixture thread',
	archiveState: 'active',
	runState: 'ready',
	lastActivityAt: new Date(2026, 9, 29, 12).toISOString(),
	sessionCwd: '/fixture/project',
	mode: 'normal',
	viewOnlyReason: null,
};
const props: Parameters<typeof ThreadRail>[0] = {
	projectId: thread.projectId,
	threads: [thread],
	activeThreadId: thread.id,
	pending: false,
	now: new Date(2026, 9, 29, 13),
	onNew: () => {},
	onOpen: () => {},
	onRename: () => {},
	onArchive: () => {},
	onRemove: () => {},
	onDeleteHistory: () => {},
};
const render = (patch: Partial<typeof props> = {}) =>
	renderToStaticMarkup(createElement(ThreadRail, {...props, ...patch}));

test('plain-prop rail renders scoped groups selected semantics and literal titles (U.3)', t => {
	const html = render({
		threads: [
			{...thread, title: '<script>fixture</script>'},
			{...thread, id: 'running', title: 'fixture running', runState: 'running'},
			{
				...thread,
				id: 'earlier',
				lastActivityAt: new Date(2026, 9, 28).toISOString(),
			},
			{...thread, id: 'archived', archiveState: 'archived'},
			{
				...thread,
				id: 'other',
				projectId: 'other-project',
				title: 'other project fixture',
			},
		],
	});
	t.true(html.includes('history · today'));
	t.true(html.includes('history · earlier'));
	t.true(html.includes('archived · 1'));
	t.true(html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
	t.false(html.includes('<script>'));
	t.false(html.includes('other project fixture'));
	t.true(html.includes('data-selected="true"'));
	t.true(html.includes('aria-current="true"'));
	t.true(html.includes('thread-status--primary'));
	t.true(html.includes('aria-label="fixture running · running"'));
});

test('rail separates desktop removal from history deletion with visible capability reasons (CHAT-12, CHAT-14)', t => {
	const html = render({
		threads: [
			thread,
			{
				...thread,
				id: 'stored',
				title: 'fixture stored',
				nanocoderSessionId: 'fixture-session',
			},
		],
		renameDisabledReason: 'rename unavailable',
		deleteHistoryDisabledReason: 'history deletion unavailable',
	});
	t.true(html.includes('aria-label="remove from desktop: fixture thread"'));
	t.true(html.includes('aria-label="delete chat history: fixture thread"'));
	t.regex(
		html,
		/aria-label="delete chat history: fixture thread"[^>]*disabled/,
	);
	t.true(html.includes('this thread has no Nanocoder history'));
	t.notRegex(html, /aria-label="rename: fixture thread"[^>]*disabled/);
	t.regex(html, /aria-label="rename: fixture stored"[^>]*disabled/);
	t.true(html.includes('rename unavailable</p>'));
	t.true(html.includes('history deletion unavailable</p>'));
});

test('rail explains absent project and pending states instead of hiding disabled controls (U.3)', t => {
	const absent = render({projectId: null});
	t.true(absent.includes('select a project first'));
	t.false(absent.includes('fixture thread'));
	t.regex(absent, /aria-label="new thread"[^>]*disabled/);
	const pending = render({pending: true});
	t.true(pending.includes('another thread request is pending'));
	t.notRegex(pending, /<button(?![^>]*disabled)/);
});

test('shell accepts a plain thread child without replacing project or stream slots (U.3)', t => {
	const html = renderToStaticMarkup(
		createElement(AppShell, {
			title: 'fixture shell',
			statusBadges: 'fixture badges',
			projectRail: 'fixture projects',
			threadRail: createElement(ThreadRail, props),
			children: 'fixture stream',
		}),
	);
	t.true(html.includes('data-shell-slot="thread-rail"'));
	t.true(html.includes('fixture projects'));
	t.true(html.includes('fixture stream'));
	t.true(html.includes('aria-label="project threads"'));
	t.false(html.includes('thread list not built yet'));
});
