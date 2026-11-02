import path from 'node:path';
import test from 'ava';
import {
	captureTerminalProcesses,
	terminateTree,
} from '@/main/terminal/process-tree';
import {Scrollback} from '@/main/terminal/scrollback';

test('TERM-09 scrollback bounds long lines, line counts and Unicode without disk', t => {
	const buffer = new Scrollback(20, 3);
	buffer.append('first\nsecond\nthird\nfourth');
	t.deepEqual(buffer.snapshot(), {
		output: 'second\nthird\nfourth',
		truncated: true,
	});
	buffer.clear();
	buffer.append(`${'a'.repeat(20)}😀`);
	t.false(/^[\uDC00-\uDFFF]/u.test(buffer.snapshot().output));
	t.true(buffer.snapshot().output.length <= 20);
	buffer.clear();
	t.deepEqual(buffer.snapshot(), {output: '', truncated: false});
});

test('TERM-09 incremental trimming matches whole-buffer trimming', t => {
	const reference = (text: string, maxChars: number, maxLines: number) => {
		let output = text.slice(-maxChars);
		if (text.length > maxChars && /^[\uDC00-\uDFFF]/u.test(output))
			output = output.slice(1);
		const lines = output.split('\n');
		return lines.length > maxLines ? lines.slice(-maxLines).join('\n') : output;
	};
	let seed = 7;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pieces = ['a', 'bc', '\n', '\n\n', '😀', 'line\n', 'x'.repeat(9)];
	const buffer = new Scrollback(40, 5);
	let expected = '';
	let truncated = false;
	for (let index = 0; index < 2000; ++index) {
		let chunk = '';
		for (let count = Math.floor(random() * 4); count >= 0; --count)
			chunk += pieces[Math.floor(random() * pieces.length)];
		buffer.append(chunk);
		const next = reference(expected + chunk, 40, 5);
		truncated ||= next !== expected + chunk;
		expected = next;
		t.deepEqual(buffer.snapshot(), {output: expected, truncated});
	}
});

test('SEC-05 teardown refuses invalid or main-process IDs and project-owned system utilities', async t => {
	for (const pid of [0, 1, -1, Number.NaN, process.pid]) {
		await t.throwsAsync(terminateTree(pid, []), {
			message: 'Invalid terminal process',
		});
	}
	const root = path.parse(process.execPath).root;
	await t.throwsAsync(terminateTree(987_654_321, [root]), {
		message: 'Unsafe system executable',
	});
	if (process.platform !== 'win32') {
		await t.throwsAsync(
			captureTerminalProcesses(987_654_321, [root], '/dev/ttys123'),
			{message: 'Unsafe system executable'},
		);
	}
});

test('SEC-05 POSIX ownership refuses a missing or malformed terminal identity', async t => {
	if (process.platform === 'win32') {
		t.pass();
		return;
	}
	for (const terminal of [undefined, '?', '/dev/../ttys123', 'not-a-tty']) {
		await t.throwsAsync(captureTerminalProcesses(10, [], terminal), {
			message: 'Invalid terminal identity',
		});
	}
});
