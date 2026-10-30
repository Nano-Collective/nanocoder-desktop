import path from 'node:path';
import test from 'ava';
import {
	captureTerminalProcesses,
	descendantPids,
	terminalProcesses,
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

test('TERM-07 terminal membership includes reparented session jobs and all their groups', t => {
	const found = terminalProcesses(
		10,
		'/dev/ttys123',
		'10 1 10 ttys123\n11 10 11 ttys123\n12 1 12 ttys123\n13 1 13 ttys124\n14 11 14 ??',
	);
	t.deepEqual(
		found.pids.sort((a, b) => a - b),
		[10, 11, 12, 14],
	);
	t.deepEqual(
		found.groups.sort((a, b) => a - b),
		[10, 11, 12, 14],
	);
	t.deepEqual(terminalProcesses(10, '?', '10 1 10 ?\n11 1 11 ?').pids, [10]);
});

test('TERM-07 process descendants include nested and detached groups, leaves first', t => {
	t.deepEqual(
		descendantPids(10, '10 1\n11 10\n12 11\n13 1\n14 10\nbad\n15 15'),
		[14, 12, 11, 10],
	);
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

test('TERM-07 malformed terminal identity cannot select unrelated terminal sessions', t => {
	const rows = `10 1 10 ttys123\n${process.pid} 1 ${process.pid} ttys123\n12 1 12 ??`;
	t.deepEqual(terminalProcesses(10, undefined, rows), {
		pids: [10],
		groups: [10],
	});
	t.false(
		terminalProcesses(10, '/dev/ttys123', rows).pids.includes(process.pid),
	);
});
