import test from 'ava';
import {type TranscriptItem, transcriptRowId} from '@/renderer/transcript';
import {
	findTranscriptMatches,
	transcriptRowKeys,
} from '@/renderer/transcript-find';

const items: TranscriptItem[] = [
	{kind: 'user', text: 'Find the API client', messageId: 'u1'},
	{kind: 'agent', text: 'The api is in src/api.ts', messageId: 'a1'},
	{kind: 'thought', text: 'api thought, not searched', messageId: 't1'},
	{
		kind: 'tool',
		id: 'call-1',
		title: 'read src/api.ts',
		status: 'completed',
		details: {
			locations: [{path: 'src/api.ts', line: 12}, {path: 'api/index.ts'}],
			input: '{"path": "src/api.ts"}',
			output: 'api ok',
			content: ['first api line', 'second line'],
		},
	},
	{
		kind: 'tool',
		id: 'call-2',
		title: 'delegate api work',
		status: 'in_progress',
		delegation: {history: false, task: 'api task'},
		details: {output: 'api hidden under the card'},
	},
	{kind: 'failure', text: 'api failure text'},
];

test('a query finds user, agent, tool title and tool details, in row order', t => {
	const matches = findTranscriptMatches(items, 'api');
	t.deepEqual(
		matches.map(match => match.id),
		[
			'user:u1:0:user:0:0',
			'agent:a1:0:agent:0:0',
			'agent:a1:0:agent:0:1',
			'tool:call-1:0:tool-title:0:0',
			'tool:call-1:0:tool-location:0:0',
			'tool:call-1:0:tool-location:1:0',
			'tool:call-1:0:tool-input:0:0',
			'tool:call-1:0:tool-output:0:0',
			'tool:call-1:0:tool-content:0:0',
			'tool:call-2:0:tool-title:0:0',
		],
	);
});

test('each match names its row, its field, and whether a disclosure must open', t => {
	const keys = transcriptRowKeys(items);
	const matches = findTranscriptMatches(items, 'api');
	t.deepEqual(matches[0], {
		id: 'user:u1:0:user:0:0',
		target: {rowKey: 'user:u1:0', itemIndex: 0, field: 'user', folded: false},
		start: 9,
		end: 12,
	});
	t.deepEqual(matches[4], {
		id: 'tool:call-1:0:tool-location:0:0',
		target: {
			rowKey: 'tool:call-1:0',
			itemIndex: 3,
			field: 'tool-location',
			fieldIndex: 0,
			folded: true,
		},
		start: 4,
		end: 7,
	});
	t.deepEqual(matches[9].target, {
		rowKey: 'tool:call-2:0',
		itemIndex: 4,
		field: 'tool-title',
		folded: false,
	});
	t.true(
		matches.every(
			match => keys[match.target.itemIndex] === match.target.rowKey,
		),
	);
});

test('thoughts, failures and delegation details are not searched', t => {
	const matches = findTranscriptMatches(items, 'api');
	t.false(
		matches.some(
			match => match.target.itemIndex === 2 || match.target.itemIndex === 5,
		),
	);
	t.false(
		matches.some(match => match.id.startsWith('tool:call-2:0:tool-output')),
	);
	t.deepEqual(findTranscriptMatches(items, ''), []);
});

test('row keys follow the ConversationStream formula, with an occurrence for repeated ids', t => {
	t.deepEqual(transcriptRowKeys(items).slice(0, 5), [
		'user:u1:0',
		'agent:a1:0',
		'thought:t1:0',
		'tool:call-1:0',
		'tool:call-2:0',
	]);
	t.is(transcriptRowKeys(items)[5], `${transcriptRowId(items[5], 5)}:0`);
	const repeated: TranscriptItem[] = [
		{kind: 'tool', id: 'same', title: 'one', status: 'completed'},
		{kind: 'tool', id: 'same', title: 'two', status: 'completed'},
	];
	t.deepEqual(transcriptRowKeys(repeated), ['tool:same:0', 'tool:same:1']);
});

test('agent Markdown search matches visible rendered text instead of raw Markdown syntax', t => {
	const formatted: TranscriptItem[] = [
		{
			kind: 'agent',
			messageId: 'md-1',
			text: 'hello **world**\n\n[alpha](https://alpha.invalid) alpha\n\n[local app](http://localhost:3000)\n\n```ts\nconst raw = "**bold**";\n```',
		},
	];
	// Phrase spanning bold markers is found.
	t.is(findTranscriptMatches(formatted, 'hello world').length, 1);
	// Link URL target is excluded, so only the two visible `alpha` words match.
	t.is(findTranscriptMatches(formatted, 'alpha').length, 2);
	// Localhost link label is found without matching the hidden URL host.
	t.is(findTranscriptMatches(formatted, 'local app').length, 1);
	t.is(findTranscriptMatches(formatted, 'localhost:3000').length, 0);
	// Fenced code body stays verbatim (including literal asterisks).
	t.is(findTranscriptMatches(formatted, '**bold**').length, 1);
});
