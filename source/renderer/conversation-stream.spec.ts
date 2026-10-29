import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConversationStream} from '@/renderer/conversation-stream';
import {
	applyEvents,
	emptyTranscript,
	type TranscriptItem,
} from '@/renderer/transcript';

const render = (items: TranscriptItem[], running = false) =>
	renderToStaticMarkup(
		createElement(ConversationStream, {
			transcript: {...emptyTranscript, items},
			running,
			children: createElement('p', null, 'approval slot fixture'),
		}),
	);

test('user and agent author labels show only reported token and cost metadata (CHAT-05 CHAT-19)', t => {
	const html = render([
		{kind: 'user', text: 'question'},
		{
			kind: 'agent',
			text: '# answer',
			metadata: {usage: {totalTokens: 20, cost: 0.01}},
		},
	]);
	t.true(html.includes('stream-author'));
	t.true(html.includes('you'));
	t.true(html.includes('Nanocoder'));
	t.true(html.includes('+20 tok'));
	t.true(html.includes('reported cost: 0.01'));
	t.true(html.includes('<h1>answer</h1>'));
	t.true(html.includes('approval slot fixture'));
	const absent = render([{kind: 'agent', text: 'no usage reported'}]);
	t.false(absent.includes('stream-token-chip'));
	t.false(absent.includes('role="progressbar"'));
});

test('a cursor belongs only to the currently streaming last agent message (CHAT-05)', t => {
	const agent: TranscriptItem = {kind: 'agent', text: 'answer'};
	t.true(render([agent], true).includes('stream-cursor'));
	t.false(render([agent]).includes('stream-cursor'));
	t.false(
		render(
			[agent, {kind: 'tool', id: 't', title: 'tool', status: 'in_progress'}],
			true,
		).includes('stream-cursor'),
	);
});

test('reasoning has its own label and tool details expand through native disclosure (CHAT-05)', t => {
	const html = render([
		{kind: 'thought', text: 'reasoning fixture'},
		{
			kind: 'tool',
			id: 't',
			title: 'fixture tool',
			status: 'in_progress',
			details: {input: '<script>fixture</script>', content: ['fixture result']},
		},
	]);
	t.true(html.includes('stream-reasoning'));
	t.true(html.includes('reasoning fixture'));
	t.true(html.includes('<details'));
	t.true(html.includes('<summary'));
	t.true(html.includes('spinner'));
	t.true(html.includes('in progress'));
	t.true(html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
	t.false(html.includes('<script>'));
});

test('tool status always has a word and a result glyph (CHAT-05)', t => {
	for (const [status, glyph] of [
		['completed', '✓'],
		['failed', '✕'],
		['pending', '○'],
	]) {
		const html = render([
			{kind: 'tool', id: 't', title: 'fixture tool', status},
		]);
		t.true(html.includes(glyph));
		t.true(html.includes(status));
	}
});

test('subagent and file-plan rows are inert truthful display, not child capabilities (ACP-12)', t => {
	const html = render([
		{kind: 'subagent', id: 'child', title: 'fixture child', state: null},
		{
			kind: 'plan',
			id: 'p',
			content: {kind: 'file', uri: 'file:///fixture/plan.md'},
		},
	]);
	t.true(html.includes('fixture child'));
	t.true(html.includes('state not reported'));
	t.true(html.includes('plan file not opened'));
	t.notRegex(html, /<button|<a\b|\shref=|\ssrc=/);
	t.false(html.includes('stop turn'));
});

test('context is shown only from an actual usage_update, never turn token totals (CHAT-19)', t => {
	const transcript = applyEvents(emptyTranscript, [
		{
			type: 'context',
			used: 12,
			size: 100,
			cost: {amount: 0.5, currency: 'USD'},
		},
	]);
	const html = renderToStaticMarkup(
		createElement(ConversationStream, {transcript, running: false}),
	);
	t.true(html.includes('role="progressbar"'));
	t.true(html.includes('aria-valuenow="12"'));
	t.true(html.includes('session cost: 0.5 USD'));
});
