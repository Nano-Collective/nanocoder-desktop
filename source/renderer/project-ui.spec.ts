import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RecentProjects} from '@/renderer/recent-projects';
import {TrustFeedback} from '@/renderer/trust-feedback';
import type {ProjectInfo} from '@/shared/ipc';

const project: ProjectInfo = {
	id: '11111111-1111-4111-8111-111111111111',
	canonicalRoot: '/fixture/<script>secret</script>',
	sessionCwd: '/fixture/<script>secret</script>',
	displayName: '<script>fixture</script>',
	trusted: false,
	defaultMode: 'normal',
	availability: 'missing',
	createdAt: '2026-01-01T00:00:00.000Z',
	lastOpenedAt: '2026-01-01T00:00:00.000Z',
};
const props = {
	projects: [project],
	activeProjectId: project.id,
	pending: false,
	onAdd: () => {},
	onOpen: () => {},
	onLocate: () => {},
};

test('recent projects escape names and paths and explain why missing roots cannot open', t => {
	const html = renderToStaticMarkup(createElement(RecentProjects, props));
	t.notRegex(html, /<script\b/i);
	t.true(html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
	t.true(html.includes('folder missing; locate it before opening'));
	t.true(html.includes('aria-current="true"'));
	const buttons = html.match(/<button[^>]*>/g) ?? [];
	t.is(buttons.length, 3);
	t.true(
		buttons
			.find(button => button.includes('aria-label="open '))
			?.includes('disabled=""'),
	);
	t.false(
		buttons
			.find(button => button.includes('aria-label="locate '))
			?.includes('disabled=""'),
	);
});

test('waiting for main disables every recent-project action and states the reason', t => {
	const html = renderToStaticMarkup(
		createElement(RecentProjects, {...props, pending: true}),
	);
	const buttons = html.match(/<button[^>]*>/g) ?? [];
	t.true(buttons.every(button => button.includes('disabled=""')));
	t.true(html.includes('waiting for the project request or native dialog'));
});

test('trust feedback escapes messages and never offers a renderer trust-grant action', t => {
	for (const status of ['ready', 'cancelled', 'untrusted', 'failed'] as const) {
		const html = renderToStaticMarkup(
			createElement(TrustFeedback, {
				feedback: {status, message: '<script>fixture</script>'},
			}),
		);
		t.notRegex(html, /<script\b/i);
		t.false(html.includes('<button'));
		t.true(
			html.includes(
				`role="${status === 'untrusted' || status === 'failed' ? 'alert' : 'status'}"`,
			),
		);
	}
	t.is(
		renderToStaticMarkup(createElement(TrustFeedback, {feedback: null})),
		'',
	);
});
