import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Button, Card, Divider, StatusBadge} from '@/renderer/ui';

test('buttons preserve native semantics and expose allow/reject variants', t => {
	const html = renderToStaticMarkup(
		createElement(Button, {variant: 'allow', disabled: true}, 'allow once'),
	);
	t.true(html.includes('type="button"'));
	t.true(html.includes('disabled=""'));
	t.true(html.includes('ui-button--allow'));
	t.true(html.includes('allow once'));
	t.true(
		renderToStaticMarkup(
			createElement(Button, {variant: 'reject', type: 'submit'}, 'reject'),
		).includes('ui-button--reject'),
	);
});

test('key hints are opt-in and keep the action name separate', t => {
	const plain = renderToStaticMarkup(createElement(Button, {}, 'send'));
	t.false(plain.includes('<kbd'));
	const hint = renderToStaticMarkup(
		createElement(Button, {keyHint: 'enter'}, 'send'),
	);
	t.true(
		hint.includes('<kbd class="ui-key-hint" aria-hidden="true">enter</kbd>'),
	);
});

test('every badge has a word as well as a decorative state glyph', t => {
	for (const status of [
		'running',
		'approval',
		'idle',
		'failed',
		'acp-ready',
		'acp-exited',
	] as const) {
		const html = renderToStaticMarkup(
			createElement(StatusBadge, {status, exitCode: 1}),
		);
		t.true(html.includes('role="status"'));
		t.true(html.includes('aria-hidden="true"'));
		t.true(html.includes(status.startsWith('acp') ? 'acp · ' : status));
		if (status === 'acp-exited') t.true(html.includes('exited (1)'));
	}
});

test('cards retain accessible names and dividers retain separator semantics', t => {
	const card = renderToStaticMarkup(
		createElement(
			Card,
			{variant: 'failure', 'aria-label': 'failure'},
			'failed',
		),
	);
	t.true(card.includes('aria-label="failure"'));
	t.true(card.includes('ui-card--failure'));
	t.true(renderToStaticMarkup(createElement(Divider)).includes('<hr'));
	t.true(
		renderToStaticMarkup(createElement(Divider, {soft: true})).includes(
			'ui-divider--soft',
		),
	);
});
