import test from 'ava';
import {
	clockTime,
	dayLabel,
	dayName,
	timeStamp,
	untimedHistoryTitle,
} from '@/renderer/message-time';

const local = (day: number, hour: number, minute: number) =>
	new Date(2026, 9, day, hour, minute).getTime();

test('live times show local clock time with a zero-padded hour and minute (A2)', t => {
	t.is(clockTime(local(31, 10, 42)), '10:42');
	t.is(clockTime(local(31, 4, 5)), '04:05');
	t.is(timeStamp(local(31, 10, 42)), new Date(local(31, 10, 42)).toISOString());
});

test('day labels name today, yesterday and older days in lowercase (A2)', t => {
	const now = local(31, 12, 0);
	t.is(dayName(local(31, 0, 1), now), 'today');
	t.is(dayName(local(30, 23, 59), now), 'yesterday');
	t.is(dayName(local(29, 9, 0), now), '29 oct');
	t.is(dayLabel(local(31, 10, 42), now), 'today · 10:42');
	t.is(dayLabel(local(30, 22, 15), now), 'yesterday · 22:15');
});

test('untimed history keeps a fixed explanation for its missing times (A2)', t => {
	t.is(untimedHistoryTitle, 'times are not saved in Nanocoder history');
});
