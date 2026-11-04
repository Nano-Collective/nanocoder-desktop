import test from 'ava';
import {createExitGuard, type ExitChoice} from '@/main/exit-guard';

function fixture(options: {enabled?: boolean} = {}) {
	let unfinished: string[] = ['b'];
	const listeners = new Set<() => void>();
	const asked: string[][] = [];
	let answer: ExitChoice | Error | Promise<ExitChoice> = 'stay';
	let enabled = options.enabled ?? true;
	const guard = createExitGuard({
		enabled: () => enabled,
		unfinished: () => unfinished,
		confirm: async ids => {
			asked.push([...ids]);
			const value = await answer;
			if (value instanceof Error) throw value;
			return value;
		},
		onChange: listener => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
	const event = () => {
		const state = {prevented: false};
		return {
			state,
			preventDefault: () => {
				state.prevented = true;
			},
		};
	};
	return {
		guard,
		asked,
		listeners,
		event,
		setAnswer: (value: typeof answer) => {
			answer = value;
		},
		setUnfinished: (value: string[]) => {
			unfinished = value;
		},
		setEnabled: (value: boolean) => {
			enabled = value;
		},
		changed: () => {
			for (const listener of [...listeners]) listener();
		},
	};
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('CHAT-22 with nothing unfinished, or switched off, exit is not stopped and nothing is asked', async t => {
	const f = fixture();
	f.setUnfinished([]);
	const idle = f.event();
	f.guard.check(idle, () => t.fail('proceed is not needed'), 'quit');
	t.false(idle.state.prevented);
	f.setUnfinished(['b']);
	f.setEnabled(false);
	const off = f.event();
	f.guard.check(off, () => t.fail('proceed is not needed'), 'quit');
	t.false(off.state.prevented);
	await settle();
	t.deepEqual(f.asked, []);
});

test('CHAT-22 an unfinished turn stops the exit and asks, naming the projects', async t => {
	const f = fixture();
	f.setUnfinished(['b', 'c']);
	const event = f.event();
	f.guard.check(event, () => t.fail('not yet'), 'quit');
	t.true(event.state.prevented);
	await settle();
	t.deepEqual(f.asked, [['b', 'c']]);
});

test('CHAT-22 keep working leaves everything running, and the next exit asks again', async t => {
	const f = fixture();
	f.setAnswer('stay');
	f.guard.check(f.event(), () => t.fail('stay never exits'), 'quit');
	await settle();
	f.guard.check(f.event(), () => t.fail('stay never exits'), 'quit');
	await settle();
	t.is(f.asked.length, 2);
});

test('CHAT-22 cancel and quit proceeds once, and later exits in that quit are not asked again', async t => {
	const f = fixture();
	f.setAnswer('cancel');
	let proceeded = 0;
	f.guard.check(f.event(), () => (proceeded += 1), 'quit');
	await settle();
	t.is(proceeded, 1);
	const later = f.event();
	f.guard.check(later, () => t.fail('no second proceed'), 'window-1');
	t.false(later.state.prevented);
	t.is(f.asked.length, 1);
});

test('CHAT-22 waiting proceeds only when the last unfinished turn ends', async t => {
	const f = fixture();
	f.setAnswer('wait');
	let proceeded = 0;
	f.guard.check(f.event(), () => (proceeded += 1), 'quit');
	await settle();
	t.is(proceeded, 0);
	f.changed();
	t.is(proceeded, 0, 'a change that leaves the turn unfinished does nothing');
	f.setUnfinished([]);
	f.changed();
	t.is(proceeded, 1);
	t.is(f.listeners.size, 0, 'it stops listening once it has proceeded');
});

test('CHAT-22 waiting proceeds at once when the turn already ended while the question was open', async t => {
	const f = fixture();
	f.setAnswer('wait');
	let proceeded = 0;
	f.guard.check(f.event(), () => (proceeded += 1), 'quit');
	f.setUnfinished([]);
	await settle();
	t.is(proceeded, 1);
});

test('CHAT-22 a second exit while the question is open is stopped without a second question', async t => {
	const f = fixture();
	let release!: (choice: ExitChoice) => void;
	f.setAnswer(
		new Promise<ExitChoice>(resolve => {
			release = resolve;
		}),
	);
	const first = f.event();
	const second = f.event();
	f.guard.check(first, () => t.fail('not yet'), 'quit');
	f.guard.check(second, () => t.fail('not yet'), 'quit');
	t.true(first.state.prevented);
	t.true(second.state.prevented);
	release('stay');
	await settle();
	t.is(f.asked.length, 1);
});

test('CHAT-22 an exit attempt while waiting asks again, so the user can change their mind', async t => {
	const f = fixture();
	f.setAnswer('wait');
	f.guard.check(f.event(), () => t.fail('still waiting'), 'quit');
	await settle();
	t.is(f.listeners.size, 1);
	f.setAnswer('stay');
	const again = f.event();
	f.guard.check(again, () => t.fail('not cancelled'), 'quit');
	t.true(again.state.prevented);
	await settle();
	t.is(f.asked.length, 2);
	t.is(f.listeners.size, 0, 'it stopped waiting before asking again');
});

test('CHAT-22 a question that cannot be shown never ends the turn', async t => {
	const f = fixture();
	f.setAnswer(new Error('no dialog'));
	const event = f.event();
	f.guard.check(event, () => t.fail('a failed question must not exit'), 'quit');
	await settle();
	t.true(event.state.prevented);
});

test('CHAT-22 closing one window is approved for that window only', async t => {
	const f = fixture();
	f.setAnswer('cancel');
	let closed = 0;
	f.guard.check(f.event(), () => (closed += 1), 'window-1');
	await settle();
	t.is(closed, 1);
	f.guard.release('window-1');
	f.setAnswer('stay');
	const next = f.event();
	f.guard.check(next, () => t.fail('a later window asks again'), 'window-1');
	t.true(next.state.prevented);
});
