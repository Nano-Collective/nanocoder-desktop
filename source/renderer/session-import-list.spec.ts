import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
	SessionImportList,
	type SessionImportListProps,
} from '@/renderer/session-import-list';

const props: SessionImportListProps = {
	projectId: 'project-a',
	active: true,
	sessions: [
		{
			id: 'saved-session',
			title: '<script>saved title</script>',
			sessionCwd: '/fixture',
			lastActivityAt: '2026-10-29T12:00:00.000Z',
		},
	],
	loading: false,
	importing: null,
	error: null,
	onRefresh: async () => true,
	onImport: async () => true,
};
const render = (next = props) =>
	renderToStaticMarkup(createElement(SessionImportList, next));

test('ACP-18 import list uses labelled native actions and escaped plain metadata, never HTML or automatic history loading', t => {
	const html = render();
	t.true(html.includes('aria-label="import saved sessions"'));
	t.true(html.includes('&lt;script&gt;saved title&lt;/script&gt;'));
	t.true(html.includes('aria-label="import saved session:'));
	t.true(html.includes('refresh saved sessions'));
	t.true(html.includes('dateTime="2026-10-29T12:00:00.000Z"'));
	t.true(html.includes('import adds a desktop thread only'));
	t.is((html.match(/<button/g) ?? []).length, 2);
	t.false(html.includes('<script>'));
	t.false(html.includes('session/resume'));
	t.false(html.includes('<input'));
});

test('ACP-18 import list disables every native action with a visible reason during loading, import or project work', t => {
	for (const patch of [
		{loading: true},
		{importing: 'saved-session'},
		{disabledReason: 'stop the project turn before importing'},
	]) {
		const html = render({...props, ...patch});
		const buttons = html.match(/<button[^>]*>/g) ?? [];
		t.is(buttons.length, 2);
		t.true(buttons.every(button => button.includes('disabled=""')));
		t.true(buttons.every(button => button.includes('type="button"')));
		t.true(html.includes('role="status"'));
	}
});

test('ACP-18 import list retains truthful empty, unknown-activity and escaped failure states', t => {
	t.true(
		render({...props, sessions: []}).includes('no sessions offered for import'),
	);
	t.true(
		render({
			...props,
			sessions: [{...props.sessions[0], lastActivityAt: null}],
			error: '<script>safe refusal</script>',
		}).includes('last active unavailable'),
	);
	const html = render({...props, error: '<script>safe refusal</script>'});
	t.true(html.includes('&lt;script&gt;safe refusal&lt;/script&gt;'));
	t.false(html.includes('<script>'));
});

test('ACP-18 inactive project has no import UI or old session metadata', t => {
	t.is(render({...props, active: false}), '');
});
