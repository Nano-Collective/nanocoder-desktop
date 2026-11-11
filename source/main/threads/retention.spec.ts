import test from 'ava';
import {
	retentionWarnings,
	retentionWarningsFromStore,
} from '@/main/threads/retention';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-12T12:00:00.000Z');
const row = (title: string, idleDays: number, id = title) => ({
	projectId: 'project',
	threadId: id,
	title,
	lastActivityAt: new Date(now.getTime() - idleDays * DAY).toISOString(),
});

test('CHAT-23 warns for threads in the last week before Nanocoder deletes them, most urgent first', t => {
	const result = retentionWarnings(
		[
			row('fresh', 2),
			row('week left', 23),
			row('day left', 29),
			row('mid', 25),
		],
		{days: 30, maxSessions: 100},
		true,
		now,
	);
	t.deepEqual(
		result.threads.map(item => [item.title, item.idleDays, item.daysLeft]),
		[
			['day left', 29, 1],
			['mid', 25, 5],
			['week left', 23, 7],
		],
	);
	t.is(result.retentionDays, 30);
	t.is(result.maxSessions, 100);
	t.true(result.reported);
});

test('CHAT-23 a thread past the limit is still listed, with no days left, since Nanocoder may not have deleted it yet', t => {
	const [item] = retentionWarnings(
		[row('old', 45)],
		{days: 30, maxSessions: 100},
		true,
		now,
	).threads;
	t.is(item.daysLeft, 0);
	t.is(item.idleDays, 45);
});

test('DEC-45 the warning window follows the limit Nanocoder reported, and shrinks for very short limits', t => {
	const long = retentionWarnings(
		[row('a', 85), row('b', 60)],
		{days: 90, maxSessions: 100},
		true,
		now,
	);
	t.deepEqual(
		long.threads.map(item => item.title),
		['a'],
	);
	const short = retentionWarnings(
		[row('c', 1), row('d', 0)],
		{days: 2, maxSessions: 100},
		true,
		now,
	);
	t.deepEqual(
		short.threads.map(item => item.title),
		['c'],
	);
	t.deepEqual(
		retentionWarnings([row('e', 0)], {days: 1, maxSessions: 100}, true, now)
			.threads,
		[],
	);
});

test('CHAT-23 a timestamp that is missing, malformed or in the future never produces a warning', t => {
	const bad = [
		{...row('none', 0), lastActivityAt: ''},
		{...row('junk', 0), lastActivityAt: 'not a date'},
		row('future', -3),
	];
	t.deepEqual(
		retentionWarnings(bad, {days: 30, maxSessions: 100}, false, now).threads,
		[],
	);
});

test('CHAT-23 the list is bounded and says when the limits are only the defaults', t => {
	const many = Array.from({length: 80}, (_, index) =>
		row(`thread ${index}`, 29, `id-${index}`),
	);
	const result = retentionWarnings(
		many,
		{days: 30, maxSessions: 100},
		false,
		now,
	);
	t.is(result.threads.length, 50);
	t.false(result.reported);
});

test('DEC-45 until Nanocoder reports its limits the defaults apply and the answer says so, afterwards its own limits do', t => {
	let limits: {days: number; maxSessions: number} | undefined;
	const store = {
		retention: {get: () => limits, set: () => {}},
		threads: {listUnpinnedSessions: () => [row('a', 29)]},
	} as unknown as Parameters<typeof retentionWarningsFromStore>[0];
	const before = retentionWarningsFromStore(store, now);
	t.false(before.reported);
	t.is(before.retentionDays, 30);
	t.is(before.threads.length, 1);
	limits = {days: 90, maxSessions: 250};
	const after = retentionWarningsFromStore(store, now);
	t.true(after.reported);
	t.is(after.retentionDays, 90);
	t.is(after.maxSessions, 250);
	t.deepEqual(after.threads, []);
});
