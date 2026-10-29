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
