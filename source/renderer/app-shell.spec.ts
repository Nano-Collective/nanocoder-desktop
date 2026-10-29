import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppShell} from '@/renderer/app-shell';

test('shell slots preserve plain child components without extra controls', t => {
	const html = renderToStaticMarkup(
		createElement(AppShell, {
			title: 'Nanocoder',
			statusBadges: createElement('span', null, 'idle'),
			projectRail: createElement('article', null, 'recent project fixture'),
			streamTools: createElement('section', null, 'diagnostics fixture'),
			composer: createElement('form', null, 'composer fixture'),
			children: createElement('ol', null, 'transcript fixture'),
		}),
	);
	for (const text of [
		'recent project fixture',
		'diagnostics fixture',
		'composer fixture',
		'transcript fixture',
	])
		t.true(html.includes(text));
	t.true(html.includes('data-shell-slot="project-rail"'));
	t.true(html.includes('data-shell-slot="stream-tools"'));
	t.false(html.includes('project list not built yet'));
	t.true(html.includes('thread list not built yet'));
	t.false(html.includes('<button'));
});

test('unfinished shell surfaces say they are placeholders rather than live actions', t => {
	const html = renderToStaticMarkup(
		createElement(AppShell, {
			title: 'Nanocoder',
			statusBadges: null,
			children: null,
		}),
	);
	for (const label of [
		'session tabs · not built yet',
		'project list not built yet',
		'files and review are not built yet',
		'palette not built yet',
	])
		t.true(html.includes(label));
	t.true(html.includes('class="shell-placeholder'));
	t.false(html.includes('role="tab"'));
	t.false(html.includes('bottom-panel'));
});
