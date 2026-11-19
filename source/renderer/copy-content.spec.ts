import test from 'ava';
import {createElement} from 'react';
import {copyableCodeText, copyContent} from '@/renderer/copy-content';

test('copy writes the original message and announces one success per action', async t => {
	const writes: string[] = [];
	const notices: string[] = [];
	const write = async (text: string) => {
		writes.push(text);
	};
	const notify = (message: string) => notices.push(message);
	t.true(await copyContent('first **original** text', write, notify));
	t.true(await copyContent('replacement text', write, notify));
	t.deepEqual(writes, ['first **original** text', 'replacement text']);
	t.deepEqual(notices, ['copied', 'copied']);
});

test('copy failure never announces success or exposes the content', async t => {
	const notices: string[] = [];
	t.false(
		await copyContent(
			'private fixture text',
			async () => {
				throw new Error('refused');
			},
			message => notices.push(message),
		),
	);
	t.deepEqual(notices, ['copy failed. clipboard access was refused.']);
	t.false(notices.join(' ').includes('private fixture text'));
});

test('fenced code extraction keeps only code text and nested Markdown nodes', t => {
	const children = createElement(
		'code',
		{className: 'language-ts'},
		'const fixture = ',
		createElement('span', null, '1'),
		';\n',
	);
	t.is(copyableCodeText(children), 'const fixture = 1;\n');
});
