import test from 'ava';
import {
	createAnnouncementHost,
	createStreamAnnouncer,
} from '@/renderer/stream-announcements';
import type {Transcript, TranscriptItem} from '@/renderer/transcript';

const user: TranscriptItem = {kind: 'user', text: 'fixture question'};
const answer = (text: string): TranscriptItem => ({kind: 'agent', text});
const transcript = (items: TranscriptItem[] = [user]): Transcript => ({
	items,
	permissions: [],
});

function fixture(autoDeliver = true) {
	let now = 0;
	let nextId = 0;
	const timers = new Map<number, {at: number; callback(): void}>();
	const messages: string[] = [];
	const announcer = createStreamAnnouncer(
		{
			schedule(callback, delay) {
				const id = ++nextId;
				timers.set(id, {at: now + delay, callback});
				return () => {
					timers.delete(id);
				};
			},
		},
		text => {
			messages.push(text);
			if (autoDeliver) announcer.delivered();
		},
	);
	return {
		announcer,
		messages,
		timers,
		advance(milliseconds: number) {
			const end = now + milliseconds;
			for (;;) {
				const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > end) break;
				now = next[1].at;
				timers.delete(next[0]);
				next[1].callback();
			}
			now = end;
		},
	};
}

test('A11Y-04/05 starts once and never announces 300 streaming tokens or historical replay', t => {
	const f = fixture();
	f.announcer.update({
		transcript: transcript([user, answer('old saved answer')]),
		running: false,
		outcome: 'completed',
	});
	t.deepEqual(f.messages, []);
	for (let count = 1; count <= 300; count++)
		f.announcer.update({
			transcript: transcript([user, answer(`partial ${count}`)]),
			running: true,
		});
	f.advance(5000);
	t.deepEqual(f.messages, ['turn started']);
	t.is(f.timers.size, 0);
});

test('A11Y-05 completion waits for the one-second limit and summarises only finished agent text', t => {
	const f = fixture();
	f.announcer.update({transcript: transcript(), running: true});
	f.announcer.update({
		transcript: transcript([user, answer('**fixture answer.**')]),
		running: false,
		outcome: 'completed',
	});
	f.advance(999);
	t.deepEqual(f.messages, ['turn started']);
	f.advance(1);
	t.deepEqual(f.messages, [
		'turn started',
		'turn completed. response finished: fixture answer.',
	]);
	f.announcer.update({
		transcript: transcript([user, answer('**fixture answer.**')]),
		running: false,
		outcome: 'completed',
	});
	f.advance(5000);
	t.is(f.messages.length, 2);
});

for (const outcome of ['failed', 'cancelled', 'interrupted'] as const) {
	test(`A11Y-04 announces ${outcome} without claiming that partial output finished`, t => {
		const f = fixture();
		f.announcer.update({transcript: transcript(), running: true});
		f.announcer.update({
			transcript: transcript([user, answer('unfinished private fixture')]),
			running: false,
			...(outcome === 'interrupted' ? {} : {outcome}),
		});
		f.advance(1000);
		t.deepEqual(f.messages, ['turn started', `turn ${outcome}`]);
		t.false(f.messages.join().includes('unfinished private fixture'));
	});
}

test('A11Y-05 a completed message before a tool gets one bounded plain-text preview', t => {
	const f = fixture();
	f.announcer.update({transcript: transcript(), running: true});
	const items: TranscriptItem[] = [
		user,
		{kind: 'thought', text: 'private reasoning'},
		answer(
			`[fixture](https://private.invalid) \`private-code\` ${'x'.repeat(300)}`,
		),
		{
			kind: 'tool',
			id: 'private-tool',
			title: 'private command',
			status: 'pending',
		},
	];
	f.announcer.update({transcript: transcript(items), running: true});
	f.advance(1000);
	const preview = f.messages[1] ?? '';
	t.true(preview.startsWith('response finished: fixture code omitted '));
	t.is(Array.from(preview.slice('response finished: '.length)).length, 160);
	t.false(preview.includes('private'));
	f.announcer.update({transcript: transcript(items), running: true});
	f.advance(1000);
	t.is(f.messages.length, 2);
});

test('A11Y-04 modal approval count owns waiting speech, including an already queued wait', t => {
	const f = fixture();
	f.announcer.update({transcript: transcript(), running: true});
	const waiting: Transcript = {
		...transcript(),
		permissions: [
			{
				id: 'private-request',
				title: 'private command',
				options: [
					{id: 'private-option', name: 'private label', kind: 'allow_once'},
				],
			},
		],
	};
	f.announcer.update({transcript: waiting, running: true});
	f.announcer.update({transcript: waiting, running: true}, true);
	f.advance(1000);
	f.announcer.update({transcript: waiting, running: true}, false);
	f.advance(1000);
	t.deepEqual(f.messages, ['turn started']);
	f.announcer.update({transcript: transcript(), running: true});
	f.announcer.update({transcript: waiting, running: true});
	f.advance(1000);
	t.is(f.messages.at(-1), 'turn waiting for approval');
	t.false(f.messages.join().includes('private'));
});

test('A11Y-04 queued completion survives modal host changes and delivered speech is never replayed', t => {
	const f = fixture();
	f.announcer.update({transcript: transcript(), running: true});
	const done = {
		transcript: transcript([user, answer('fixture final')]),
		running: false,
		outcome: 'completed' as const,
	};
	f.announcer.update(done);
	f.advance(400);
	f.announcer.update(done, true);
	f.advance(400);
	f.announcer.update(done, false);
	t.deepEqual(f.messages, ['turn started']);
	f.advance(200);
	t.is(f.messages[1], 'turn completed. response finished: fixture final');
	f.announcer.update(done, true);
	f.announcer.update(done, false);
	f.advance(5000);
	t.is(f.messages.length, 2);
});

test('A11Y-05 disposal cancels pending speech and ignores a late timer callback', t => {
	const f = fixture();
	f.announcer.update({transcript: transcript(), running: true});
	const late = [...f.timers.values()][0]?.callback;
	f.announcer.update({
		transcript: transcript(),
		running: false,
		outcome: 'failed',
	});
	f.announcer.dispose();
	t.is(f.timers.size, 0);
	late?.();
	f.announcer.update({transcript: transcript(), running: true});
	f.advance(5000);
	t.deepEqual(f.messages, ['turn started']);
});

test('A11Y-05 the rate window begins only after the host has written the message', t => {
	const f = fixture(false);
	f.announcer.update({transcript: transcript(), running: true});
	f.announcer.update({
		transcript: transcript(),
		running: false,
		outcome: 'completed',
	});
	f.advance(5000);
	t.deepEqual(f.messages, ['turn started']);
	f.announcer.delivered();
	f.advance(999);
	t.is(f.messages.length, 1);
	f.advance(1);
	t.deepEqual(f.messages, ['turn started', 'turn completed']);
});

test('A11Y-04 portable host writes only after two settled frames and neither replays nor loses text on open/close', t => {
	const node = {owner: 'detached', text: ''};
	let destination = 'normal';
	const frames = new Set<() => void>();
	const writes: Array<{owner: string; text: string}> = [];
	let deliveries = 0;
	const host = createAnnouncementHost({
		place() {
			if (node.owner === destination) return false;
			node.owner = destination;
			return true;
		},
		write(text) {
			node.text = text;
			writes.push({...node});
		},
		frame(callback) {
			frames.add(callback);
			return () => {
				frames.delete(callback);
			};
		},
		delivered: () => deliveries++,
	});
	const frame = () => {
		const pending = [...frames];
		frames.clear();
		for (const callback of pending) callback();
	};
	host.publish('turn started');
	frame();
	t.deepEqual(writes, []);
	destination = 'modal';
	host.move();
	frame();
	t.deepEqual(writes, []);
	frame();
	t.deepEqual(writes, [{owner: 'modal', text: 'turn started'}]);
	destination = 'normal';
	host.move();
	t.is(node.text, 'turn started');
	t.is(writes.length, 1);
	host.publish('turn completed');
	destination = 'modal';
	host.move();
	destination = 'normal';
	host.move();
	frame();
	t.is(writes.length, 1);
	frame();
	t.deepEqual(writes, [
		{owner: 'modal', text: 'turn started'},
		{owner: 'normal', text: 'turn completed'},
	]);
	t.is(deliveries, 2);
	host.publish('stale fixture');
	const late = [...frames][0];
	host.dispose();
	late?.();
	frame();
	t.is(writes.length, 2);
});

for (const outcome of ['completed', 'failed', 'cancelled'] as const) {
	test(`A11Y-04 authoritative ${outcome} replaces a queued implicit interruption`, t => {
		const f = fixture();
		f.announcer.update({transcript: transcript(), running: true});
		f.announcer.update({transcript: transcript(), running: false});
		f.announcer.update({
			transcript: transcript([user, answer('fixture answer')]),
			running: false,
			outcome,
		});
		f.advance(1000);
		t.deepEqual(f.messages, [
			'turn started',
			`turn ${outcome}${outcome === 'completed' ? '. response finished: fixture answer' : ''}`,
		]);
	});
}

test('A11Y-05 an unclosed or input-bounded code fence is omitted rather than spoken', t => {
	for (const fence of ['```', '~~~']) {
		const f = fixture();
		f.announcer.update({transcript: transcript(), running: true});
		f.announcer.update({
			transcript: transcript([
				user,
				answer(
					`fixture prose\n${fence}js\nprivate fixture code ${'x'.repeat(5000)}\n${fence}`,
				),
			]),
			running: false,
			outcome: 'completed',
		});
		f.advance(1000);
		t.is(
			f.messages[1],
			'turn completed. response finished: fixture prose code omitted',
		);
	}
});

test('A11Y-04 withdrawn waiting text is cleared before the node moves to the modal approval-count owner', t => {
	let owner = 'normal';
	const events: string[] = [];
	const frames: Array<() => void> = [];
	const host = createAnnouncementHost({
		place() {
			if (owner === 'modal') return false;
			owner = 'modal';
			events.push('move:modal');
			return true;
		},
		write(text) {
			events.push(`write:${owner}:${text}`);
		},
		frame(callback) {
			frames.push(callback);
			return () => {};
		},
		delivered() {},
	});
	host.publish('');
	host.move();
	t.deepEqual(events, ['write:normal:', 'move:modal']);
	t.is(frames.length, 0);
	host.dispose();
});

test('A11Y-05 the 160-character preview does not split Unicode surrogate pairs', t => {
	const f = fixture();
	const character = String.fromCodePoint(0x1d465);
	f.announcer.update({transcript: transcript(), running: true});
	f.announcer.update({
		transcript: transcript([user, answer(character.repeat(300))]),
		running: false,
		outcome: 'completed',
	});
	f.advance(1000);
	t.is(
		f.messages[1],
		`turn completed. response finished: ${character.repeat(159)}…`,
	);
});
