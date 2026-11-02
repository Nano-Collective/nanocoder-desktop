import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
	commandDraft,
	SlashSuggestions,
	suggestedCommands,
} from '@/renderer/stream-commands';

const commands = [
	{name: 'review', description: 'review changes', inputHint: 'focus'},
	{name: 'reset', description: 'reset context'},
];

test('slash suggestions come only from advertised names and clear with the command snapshot (CHAT-20)', t => {
	t.deepEqual(suggestedCommands(commands, '/re'), commands);
	t.deepEqual(suggestedCommands(commands, '/review'), [commands[0]]);
	t.deepEqual(suggestedCommands(commands, '/help'), []);
	t.deepEqual(suggestedCommands([], '/re'), []);
	t.deepEqual(suggestedCommands(commands, 'review'), []);
	t.deepEqual(suggestedCommands(commands, '/review focus'), []);
});

test('selecting an advertised slash command constructs a draft, never runs a prompt (CHAT-20)', t => {
	t.is(commandDraft('review'), '/review ');
	t.is(commandDraft('/review'), '/review ');
	for (const name of [
		'review\nsend secret',
		'',
		'review argument',
		'review;other',
	])
		t.is(commandDraft(name), undefined);
	const html = renderToStaticMarkup(
		createElement(SlashSuggestions, {
			commands,
			draft: '/rev',
			disabled: false,
			onInsert: () => t.fail('render must not call the draft callback'),
		}),
	);
	t.true(html.includes('type="button"'));
	t.true(html.includes('review changes'));
	t.true(html.includes('focus'));
});
