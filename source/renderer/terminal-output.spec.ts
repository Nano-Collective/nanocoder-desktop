import test from 'ava';
import {TerminalOutput} from '@/renderer/terminal-output';

function fixture() {
	let mode = true;
	let generation = 0;
	let buffer = '';
	let live = '';
	const writes: (() => void)[] = [];
	const announcements: (() => void)[] = [];
	const terminal = {
		options: {
			get screenReaderMode() {
				return mode;
			},
			set screenReaderMode(value: boolean | undefined) {
				if (mode && !value) {
					++generation;
					live = '';
				}
				mode = !!value;
			},
		},
		reset() {
			buffer = '';
		},
		write(data: string, callback: () => void) {
			writes.push(() => {
				buffer += data;
				const current = generation;
				announcements.push(() => {
					if (current === generation && mode) live += data;
				});
				callback();
			});
		},
	};
	return {
		writer: new TerminalOutput(terminal),
		write: () => writes.shift()?.(),
		announce: () => {
			for (const callback of announcements.splice(0)) callback();
		},
		state: () => ({buffer, live, mode}),
	};
}

test('TERM-07 stop during an in-flight write clears the buffer and delayed accessibility announcements', t => {
	const value = fixture();
	value.writer.update('restarted');
	value.writer.update('');
	value.write();
	value.announce();
	t.deepEqual(value.state(), {buffer: '', live: '', mode: true});
});

test('TERM-04 clear discards existing live text and pending announcements without changing the preference', t => {
	const value = fixture();
	value.writer.update('old command');
	value.write();
	value.announce();
	t.is(value.state().live, 'old command');
	value.writer.update('');
	value.announce();
	t.deepEqual(value.state(), {buffer: '', live: '', mode: true});
	value.writer.update('fresh');
	value.write();
	value.announce();
	t.is(value.state().buffer, 'fresh');
	t.is(value.state().live, 'fresh');
});

test('TERM-04 disposed output cannot repaint a queued old batch', t => {
	const value = fixture();
	value.writer.update('old');
	value.writer.update('new');
	value.writer.dispose();
	value.write();
	t.is(value.state().buffer, 'old');
	value.write();
	t.is(value.state().buffer, 'old');
});
