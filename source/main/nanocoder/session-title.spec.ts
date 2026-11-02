import test from 'ava';
import {sessionTitle} from '@/main/nanocoder/session-title';

test('title notifications keep only a bounded session ID and non-empty title (CHAT-12)', t => {
	t.deepEqual(
		sessionTitle({
			sessionId: 'fixture-session',
			title: '  fixture generated title  ',
			unknown: 'ignored vendor field',
		}),
		{sessionId: 'fixture-session', title: 'fixture generated title'},
	);
	t.deepEqual(
		sessionTitle({sessionId: 's'.repeat(200), title: 't'.repeat(500)}),
		{sessionId: 's'.repeat(200), title: 't'.repeat(500)},
	);
	for (const value of [
		null,
		[],
		'title',
		{},
		{sessionId: '', title: 'fixture'},
		{sessionId: 's'.repeat(201), title: 'fixture'},
		{sessionId: 42, title: 'fixture'},
		{sessionId: 'fixture', title: ''},
		{sessionId: 'fixture', title: '   '},
		{sessionId: 'fixture', title: 't'.repeat(501)},
		{sessionId: 'fixture', title: {text: 'fixture'}},
	])
		t.is(sessionTitle(value), undefined);
});
