import test from 'ava';
import {
	baselineFor,
	parseTimelineEntries,
	parseTimelineRead,
	type TimelineEntry,
} from '@/main/nanocoder/timeline';

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
	id: 'a',
	seq: 1,
	truncateToMessageIndex: 0,
	filesChanged: [],
	createdFiles: [],
	...over,
});

test('GIT-09 timeline entries keep only bounded fields and drop malformed rows', t => {
	t.deepEqual(
		parseTimelineEntries({
			entries: [
				{
					id: 'c1',
					seq: 1,
					truncateToMessageIndex: 2,
					filesChanged: ['a.txt'],
					createdFiles: ['b.txt'],
					turnId: 't1',
					title: 'ignored',
					toolName: 'write_file',
				},
				{id: 7, seq: 2, truncateToMessageIndex: 2, filesChanged: []},
				{id: 'c3', seq: 'x', truncateToMessageIndex: 2, filesChanged: []},
				{
					id: 'c4',
					seq: 4,
					truncateToMessageIndex: 2,
					filesChanged: [1],
					createdFiles: [],
				},
			],
		}),
		[
			{
				id: 'c1',
				seq: 1,
				truncateToMessageIndex: 2,
				filesChanged: ['a.txt'],
				createdFiles: ['b.txt'],
				turnId: 't1',
			},
		],
	);
	for (const value of [null, [], 'x', {}, {entries: 'x'}])
		t.is(parseTimelineEntries(value), undefined);
});

test('GIT-09 timeline entries are bounded in number and size', t => {
	const many = Array.from({length: 1_000}, (_, index) => ({
		id: `c${index}`,
		seq: index,
		truncateToMessageIndex: 0,
		filesChanged: [],
		createdFiles: [],
	}));
	t.is(parseTimelineEntries({entries: many})?.length, 200);
	t.deepEqual(
		parseTimelineEntries({
			entries: [
				{
					id: 'x'.repeat(201),
					seq: 1,
					truncateToMessageIndex: 0,
					filesChanged: [],
					createdFiles: [],
				},
			],
		}),
		[],
	);
});

test('GIT-09 a read answer is text, created or unavailable with a bounded reason', t => {
	t.deepEqual(parseTimelineRead({kind: 'text', content: 'before\n'}), {
		kind: 'text',
		content: 'before\n',
	});
	t.deepEqual(parseTimelineRead({kind: 'created'}), {kind: 'created'});
	t.deepEqual(parseTimelineRead({kind: 'unavailable', reason: 'pruned'}), {
		kind: 'unavailable',
		reason: 'pruned',
	});
	for (const value of [
		null,
		{},
		{kind: 'text'},
		{kind: 'text', content: 4},
		{kind: 'other'},
		[],
	])
		t.is(parseTimelineRead(value), undefined);
	t.is(
		(
			parseTimelineRead({kind: 'unavailable', reason: 'r'.repeat(5_000)}) as {
				reason: string;
			}
		).reason.length,
		500,
	);
});

test('GIT-09 the baseline is the earliest checkpoint of the latest turn that touched the path', t => {
	const entries = [
		entry({id: 'old', seq: 1, truncateToMessageIndex: 1, filesChanged: ['a']}),
		entry({
			id: 'first',
			seq: 2,
			truncateToMessageIndex: 4,
			filesChanged: ['a'],
		}),
		entry({
			id: 'second',
			seq: 3,
			truncateToMessageIndex: 4,
			filesChanged: ['a', 'b'],
		}),
		entry({
			id: 'other',
			seq: 4,
			truncateToMessageIndex: 6,
			filesChanged: ['c'],
		}),
	];
	t.is(baselineFor(entries, 'a')?.entry.id, 'first');
	t.is(baselineFor(entries, 'b')?.entry.id, 'second');
	t.is(baselineFor(entries, 'c')?.entry.id, 'other');
	t.is(baselineFor(entries, 'missing'), undefined);
});

test('GIT-09 a file the turn created has a created baseline, and entries are order independent', t => {
	const entries = [
		entry({
			id: 'second',
			seq: 3,
			truncateToMessageIndex: 2,
			filesChanged: ['n'],
		}),
		entry({
			id: 'first',
			seq: 2,
			truncateToMessageIndex: 2,
			filesChanged: ['n'],
			createdFiles: ['n'],
		}),
	];
	t.like(baselineFor(entries, 'n'), {created: true});
	t.is(baselineFor(entries, 'n')?.entry.id, 'first');
});

test('GIT-09 turn identities separate checkpoints that share a message index', t => {
	const entries = [
		entry({
			id: 'a',
			seq: 1,
			truncateToMessageIndex: 2,
			turnId: 't1',
			filesChanged: ['f'],
		}),
		entry({
			id: 'b',
			seq: 2,
			truncateToMessageIndex: 2,
			turnId: 't2',
			filesChanged: ['f'],
		}),
	];
	t.is(baselineFor(entries, 'f')?.entry.id, 'b');
});
