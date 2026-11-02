import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentMarkdown} from '@/renderer/agent-markdown';

const render = (text: string) =>
	renderToStaticMarkup(createElement(AgentMarkdown, {text}));

test('renders agent CommonMark headings lists blockquotes and code without plugins (CHAT-05 DEC-39)', t => {
	const html = render(
		'# fixture\n\n- one\n- two\n\n> quote\n\n```ts\nconst fixture = 1;\n```\n\n**important** and `inline`',
	);
	for (const tag of [
		'<h1>',
		'<ul>',
		'<blockquote>',
		'<pre>',
		'<strong>',
		'<code',
	])
		t.true(html.includes(tag), tag);
});

test('Markdown HTML is never executed or promoted into DOM elements (DEC-39)', t => {
	const html = render(
		'<script>alert("fixture")</script>\n\n<iframe src="https://fixture.invalid"></iframe>\n\n<img src="file:///fixture" onerror="alert(1)">',
	);
	t.notRegex(html, /<(?:script|iframe|img)\b/);
	t.notRegex(html, /\s(?:onerror|src)=/);
});

test('every Markdown image is a text placeholder, never a remote or local load (DEC-39)', t => {
	for (const target of [
		'https://fixture.invalid/image',
		'file:///fixture/image',
		'data:image/svg+xml,fixture',
		'//fixture.invalid/image',
	]) {
		const html = render(`![fixture alt](${target})`);
		t.true(html.includes('[image not loaded: fixture alt]'));
		t.notRegex(html, /<(?:img|source|video|audio)\b|\s(?:src|srcset)=/);
		t.false(html.includes(target));
	}
});

test('GFM tables render as inert table elements, with raw HTML still skipped (C-25 DEC-39)', t => {
	const html = render(
		'| check | result |\n| --- | --- |\n| build | pass |\n| <script>alert("fixture")</script> | <img src="file:///fixture"> |',
	);
	for (const tag of ['<table', '<thead>', '<tbody>', '<tr>', '<th', '<td']) {
		t.true(html.includes(tag), tag);
	}
	t.true(html.includes('build'));
	t.notRegex(
		html,
		/<(?:script|img|button|select|textarea)\b|\s(?:src|onerror)=/,
	);
	t.notRegex(html, /<(?:input|a)\b|\shref=/);
});

test('GFM strikethrough and task checkboxes render inert and disabled (C-25 DEC-39)', t => {
	const html = render('~~fixture~~\n\n- [x] fixture done\n- [ ] fixture open');
	t.true(html.includes('<del>fixture</del>'));
	const inputs = html.match(/<input\b[^>]*>/g) ?? [];
	t.is(inputs.length, 2);
	for (const input of inputs) {
		t.regex(input, /type="checkbox"/);
		t.regex(input, /\sdisabled=""/);
	}
	t.regex(html, /<input[^>]*\schecked=""/);
	t.notRegex(html, /<(?:button|select|textarea)\b|\sonchange=/);
});

test('autolinks go through the same inert link path (C-25 DEC-39)', t => {
	for (const target of [
		'https://fixture.invalid',
		'www.fixture.invalid',
		'fixture@fixture.invalid',
		'<https://fixture.invalid>',
	]) {
		const html = render(`see ${target} now`);
		const label = target.replace(/[<>]/g, '');
		t.true(
			html.includes(`<span class="stream-markdown-link">${label}</span>`),
			target,
		);
		t.notRegex(html, /<a\b|\shref=|\sonclick=|role="link"/);
		t.false(html.includes('mailto:'));
	}
});

test('an unsafe link inside a table stays refused and inert (C-25 DEC-39)', t => {
	const html = render(
		'| link | value |\n| --- | --- |\n| [fixture](javascript:alert%281%29) | https://fixture.invalid |',
	);
	t.true(html.includes('<span class="stream-markdown-link">fixture</span>'));
	t.true(
		html.includes(
			'<span class="stream-markdown-link">https://fixture.invalid</span>',
		),
	);
	t.notRegex(html, /<a\b|\shref=|javascript:/);
});

test('unsupported GFM footnotes keep their text instead of dropping it (C-25 DEC-39)', t => {
	const html = render('A fixture note[^1].\n\n[^1]: fixture footnote text.');
	t.true(html.includes('fixture footnote text.'));
	t.notRegex(html, /<(?:section|sup)\b|\shref=/);
});

test('links are inert text for all schemes until main owns external navigation (DEC-39)', t => {
	for (const target of [
		'https://fixture.invalid',
		'http://fixture.invalid',
		'javascript:alert%281%29',
		'file:///fixture',
		'data:text/html,fixture',
		'app://fixture',
		'#fragment',
	]) {
		const html = render(`[fixture link](${target})`);
		t.true(html.includes('fixture link'));
		t.notRegex(html, /<a\b|\shref=|\sonclick=|role="link"/);
		t.false(html.includes(target));
	}
});
