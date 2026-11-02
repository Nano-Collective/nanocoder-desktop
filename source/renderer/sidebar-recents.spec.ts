import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SidebarRecents} from '@/renderer/sidebar-recents';
import type {ProjectInfo} from '@/shared/ipc';

const project: ProjectInfo = {
	id: 'fixture-project',
	canonicalRoot: '/fixture/tide',
	sessionCwd: '/fixture/tide',
	displayName: 'tide',
	trusted: true,
	defaultMode: 'normal',
	lastOpenedAt: new Date(2026, 9, 28, 13).toISOString(),
	createdAt: new Date(2026, 9, 1).toISOString(),
	availability: 'available',
};
const props: Parameters<typeof SidebarRecents>[0] = {
	projects: [project],
	pending: false,
	now: new Date(2026, 9, 29, 13),
	onOpen: () => {},
	onLocate: () => {},
};
const render = (patch: Partial<typeof props> = {}) =>
	renderToStaticMarkup(createElement(SidebarRecents, {...props, ...patch}));

test('sidebar recents list projects with a count and age, and render nothing when empty (B-07)', t => {
	const html = render();
	t.true(html.includes('recent projects</span>'));
	t.regex(html, /<span class="side-label-count">1<\/span>/);
	t.true(html.includes('aria-label="tide · open"'));
	t.regex(html, /<time class="sidebar-recent-age"[^>]*>1d<\/time>/);
	t.is(render({projects: []}), '');
});

test('sidebar recents locate missing folders and wait while a request is pending (B-07)', t => {
	const missing = render({
		projects: [{...project, availability: 'missing'}],
	});
	t.true(missing.includes('aria-label="tide · locate"'));
	t.regex(render({pending: true}), /class="sidebar-recent"[^>]*disabled/);
});
