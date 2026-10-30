import test from 'ava';
import {threadAppearance, threadGroups} from '@/renderer/thread-rail-model';
import type {ThreadInfo} from '@/shared/ipc';

const thread: ThreadInfo = {
	id: 'fixture-thread',
	projectId: 'fixture-project',
	nanocoderSessionId: null,
	title: 'fixture thread',
	archiveState: 'active',
	runState: 'ready',
	lastActivityAt: new Date(2026, 9, 29, 0, 10).toISOString(),
	sessionCwd: '/fixture/project',
	mode: 'normal',
	viewOnlyReason: null,
};

test('rail groups only its project by local today earlier and separate archives in activity order (CHAT-03, CHAT-13)', t => {
	const rows: ThreadInfo[] = [
		{
			...thread,
			id: 'earlier',
			lastActivityAt: new Date(2026, 9, 28, 23, 59).toISOString(),
		},
		{...thread, id: 'archived', archiveState: 'archived'},
		{...thread, id: 'today-a'},
		{
			...thread,
			id: 'today-z',
			lastActivityAt: new Date(2026, 9, 29, 0, 20).toISOString(),
		},
		{...thread, id: 'other', projectId: 'another-project'},
	];
	const before = structuredClone(rows);
	t.deepEqual(
		threadGroups(thread.projectId, rows, new Date(2026, 9, 29, 0, 30)).map(
			group => ({id: group.id, threads: group.threads.map(row => row.id)}),
		),
		[
			{id: 'today', threads: ['today-z', 'today-a']},
			{id: 'earlier', threads: ['earlier']},
			{id: 'archived', threads: ['archived']},
		],
	);
	t.deepEqual(rows, before);
	t.deepEqual(threadGroups(null, rows, new Date()), []);
});

test('rail state glyphs have words and the design tones, with archive taking precedence (U.3)', t => {
	for (const [state, glyph, tone, label] of [
		['new', '◌', 'muted', 'new'],
		['ready', '○', 'muted', 'ready'],
		['running', '●', 'primary', 'running'],
		['waiting-approval', '◐', 'warning', 'waiting for approval'],
		['interrupted', '▲', 'warning', 'interrupted'],
		['failed', '✕', 'error', 'failed'],
		['view-only', '◍', 'muted', 'view-only'],
	] as const) {
		t.deepEqual(threadAppearance({...thread, runState: state}), {
			glyph,
			tone,
			label,
		});
	}
	t.deepEqual(
		threadAppearance({
			...thread,
			runState: 'running',
			archiveState: 'archived',
		}),
		{glyph: '░', tone: 'muted', label: 'archived'},
	);
});
