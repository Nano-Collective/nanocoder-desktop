import test from 'ava';
import {type TranscriptItem} from '@/renderer/transcript';
import {
	findTranscriptMatches,
	transcriptRowKeys,
} from '@/renderer/transcript-find';
import {
	clearTranscriptFind,
	fieldFindSpans,
	inFindViewport,
	paintTranscriptFind,
} from '@/renderer/transcript-highlights';

const segment = (node: string, text: string) => ({node, text});

test('a match inside one text node starts and ends in that node', t => {
	const [span] = fieldFindSpans(
		'row:user:0',
		[segment('a', 'find me here')],
		'me',
	);
	t.deepEqual(span, {
		id: 'row:user:0:0',
		start: {node: 'a', offset: 5},
		end: {node: 'a', offset: 7},
	});
});

test('a match across text nodes keeps each edge in the node that holds it', t => {
	const [span] = fieldFindSpans(
		'row:agent:0',
		[segment('a', 'foo '), segment('b', 'bar')],
		'o b',
	);
	t.deepEqual(span, {
		id: 'row:agent:0:0',
		start: {node: 'a', offset: 2},
		end: {node: 'b', offset: 1},
	});
});

test('an edge never lands in an empty text node', t => {
	const [span] = fieldFindSpans(
		'row:user:0',
		[segment('a', ''), segment('b', 'xy'), segment('c', '')],
		'xy',
	);
	t.deepEqual(span.start, {node: 'b', offset: 0});
	t.deepEqual(span.end, {node: 'b', offset: 2});
});

test('matches are numbered within their field and ignore letter case', t => {
	const spans = fieldFindSpans(
		'row:tool-title:0',
		[segment('a', 'Api and API')],
		'api',
	);
	t.deepEqual(
		spans.map(span => span.id),
		['row:tool-title:0:0', 'row:tool-title:0:1'],
	);
});

test('an empty query or an empty field has no spans', t => {
	t.deepEqual(fieldFindSpans('row:user:0', [segment('a', 'text')], ''), []);
	t.deepEqual(fieldFindSpans('row:user:0', [], 'text'), []);
});

test('painted field ids are the ids transcript-find gives the same matches', t => {
	const items: TranscriptItem[] = [
		{kind: 'user', text: 'Find the API client', messageId: 'u1'},
		{
			kind: 'tool',
			id: 'call-1',
			title: 'read src/api.ts',
			status: 'completed',
			details: {
				locations: [{path: 'src/api.ts', line: 12}],
				content: ['first api line', 'second api line'],
			},
		},
	];
	const keys = transcriptRowKeys(items);
	const model = findTranscriptMatches(items, 'api').map(match => match.id);
	const painted = [
		...fieldFindSpans(
			`${keys[0]}:user:0`,
			[segment('user', 'Find the API client')],
			'api',
		),
		...fieldFindSpans(
			`${keys[1]}:tool-title:0`,
			[segment('title', 'read src/api.ts')],
			'api',
		),
		...fieldFindSpans(
			`${keys[1]}:tool-location:0`,
			[segment('location', 'src/api.ts:12')],
			'api',
		),
		...fieldFindSpans(
			`${keys[1]}:tool-content:0`,
			[segment('first', 'first api line')],
			'api',
		),
		...fieldFindSpans(
			`${keys[1]}:tool-content:1`,
			[segment('second', 'second api line')],
			'api',
		),
	].map(span => span.id);
	t.deepEqual(painted, model);
});

test('painting or clearing outside a browser does nothing (A11Y-06 guard)', t => {
	t.is(paintTranscriptFind(null, 'api', null), null);
	t.notThrows(() => clearTranscriptFind());
});

test('viewport culling keeps visible and overscan rows and skips distant rows', t => {
	const viewport = {top: 100, bottom: 700};
	t.true(inFindViewport({top: 200, bottom: 260}, viewport, 300));
	t.true(inFindViewport({top: -250, bottom: -200}, viewport, 300));
	t.true(inFindViewport({top: 1000, bottom: 1040}, viewport, 300));
	t.false(inFindViewport({top: -500, bottom: -201}, viewport, 300));
	t.false(inFindViewport({top: 1001, bottom: 1100}, viewport, 300));
});
