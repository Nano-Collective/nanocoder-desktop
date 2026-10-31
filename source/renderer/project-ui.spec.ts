import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectsDialogBody} from '@/renderer/projects-dialog';
import {ProjectSwitch} from '@/renderer/recent-projects';
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
const available: ProjectInfo = {
	...project,
	id: '22222222-2222-4222-8222-222222222222',
	canonicalRoot: '/fixture/ready',
	sessionCwd: '/fixture/ready',
	displayName: 'ready',
	availability: 'available',
};
const props = {
	projects: [project],
	activeProjectId: project.id,
	pending: false,
	onAdd: () => {},
	onOpen: () => {},
	onLocate: () => {},
};

test('project switch escapes the selected name and root and opens a dialog', t => {
	const html = renderToStaticMarkup(
		createElement(ProjectSwitch, {selected: project, onOpen: () => {}}),
	);
	t.notRegex(html, /<script\b/i);
	t.true(html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
	t.true(html.includes('aria-label="switch project"'));
	t.true(html.includes('aria-haspopup="dialog"'));
});

test('recent projects escape names and paths and explain why missing roots cannot open', t => {
	const html = renderToStaticMarkup(createElement(ProjectsDialogBody, props));
	t.notRegex(html, /<script\b/i);
	t.true(html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
	t.true(html.includes('folder missing; locate it before opening'));
	t.true(html.includes('selected'));
	const buttons = html.match(/<button[^>]*>/g) ?? [];
	t.is(buttons.length, 1);
	t.true(buttons[0]?.includes('aria-label="locate '));
	t.false(buttons[0]?.includes('disabled=""'));
	t.false(html.includes('aria-label="open '));
});

test('an available project is the current row and opens by its own action', t => {
	const html = renderToStaticMarkup(
		createElement(ProjectsDialogBody, {
			...props,
			projects: [available],
			activeProjectId: available.id,
		}),
	);
	t.true(html.includes('aria-current="true"'));
	t.true(html.includes('aria-label="open ready"'));
	t.true(html.includes('✓'));
});

test('waiting for main disables every recent-project action and states the reason', t => {
	const html = renderToStaticMarkup(
		createElement(ProjectsDialogBody, {
			...props,
			projects: [project, available],
			pending: true,
		}),
	);
	const buttons = html.match(/<button[^>]*>/g) ?? [];
	t.is(buttons.length, 2);
	t.true(buttons.every(button => button.includes('disabled=""')));
	t.true(html.includes('waiting for the project request or native dialog'));
});

test('an empty recent list says so inside the recent projects region', t => {
	const html = renderToStaticMarkup(
		createElement(ProjectsDialogBody, {
			...props,
			projects: [],
			activeProjectId: null,
		}),
	);
	t.true(
		html.includes(
			'<section aria-label="recent projects"><p>no recent projects</p></section>',
		),
	);
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
