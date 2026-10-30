import test from 'ava';
import {
	stopPosixTree,
	terminalProcesses,
	waitForProcessExit,
} from '@/main/terminal/process-tree';

function fixture(
	read: () => string,
	send?: (pid: number, value: NodeJS.Signals) => void,
) {
	let now = 0;
	const signals: [number, NodeJS.Signals][] = [];
	return {
		signals,
		operations: {
			read: async () => read(),
			signal(pid: number, value: NodeJS.Signals) {
				signals.push([pid, value]);
				send?.(pid, value);
			},
			wait: async (ms: number) => {
				now += ms;
			},
			now: () => now,
		},
	};
}

test('TERM-07 EPERM on an exited zombie group is confirmed stopped, not a false failure', async t => {
	let reads = 0;
	const value = fixture(
		() => (++reads === 1 ? '10 1 10 S ttys123' : '10 1 10 Z ttys123'),
		(_pid, signal) => {
			if (signal !== 'SIGHUP')
				throw Object.assign(new Error('not signalable'), {code: 'EPERM'});
		},
	);
	await stopPosixTree(
		10,
		'/dev/ttys123',
		{pids: [10], groups: [10]},
		value.operations,
	);
	t.true(
		value.signals.some(([pid, signal]) => pid === -10 && signal === 'SIGKILL'),
	);
	t.true(reads >= 3);
});

test('TERM-07 EPERM with a live survivor fails within its bound and resumes stopped survivors', async t => {
	const value = fixture(
		() => '10 1 10 S ttys123',
		(pid, signal) => {
			if (pid < 0 || signal === 'SIGKILL')
				throw Object.assign(new Error('not signalable'), {code: 'EPERM'});
		},
	);
	await t.throwsAsync(
		stopPosixTree(
			10,
			'/dev/ttys123',
			{pids: [10], groups: [10]},
			value.operations,
		),
		{message: 'Terminal processes remain alive'},
	);
	t.true(
		value.signals.some(([pid, signal]) => pid === 10 && signal === 'SIGCONT'),
	);
	t.true(value.operations.now() <= 2000);
});

test('TERM-07 a lost shell cannot adopt a newly reused tty during escalation', async t => {
	let reads = 0;
	const value = fixture(() =>
		++reads === 1
			? '10 1 10 S ttys123\n11 10 11 S ttys123'
			: '99 1 99 S ttys123',
	);
	await stopPosixTree(
		10,
		'/dev/ttys123',
		{pids: [10], groups: [10]},
		value.operations,
	);
	t.false(value.signals.some(([pid]) => Math.abs(pid) === 99));
	t.true(
		value.signals.some(([pid, signal]) => pid === -11 && signal === 'SIGKILL'),
	);
	t.deepEqual(terminalProcesses(10, '/dev/ttys123', '99 1 99 ttys123'), {
		pids: [10],
		groups: [],
	});
});

test('TERM-07 discovery errors still attempt retained cleanup and never claim success', async t => {
	const value = fixture(() => {
		throw new Error('discovery failed');
	});
	await t.throwsAsync(
		stopPosixTree(
			10,
			'/dev/ttys123',
			{pids: [10, 11], groups: [10, 11]},
			value.operations,
		),
		{message: 'discovery failed'},
	);
	t.true(
		value.signals.some(([pid, signal]) => pid === -11 && signal === 'SIGKILL'),
	);
	t.true(
		value.signals.some(([pid, signal]) => pid === -11 && signal === 'SIGCONT'),
	);
});

test('TERM-07 process reaping waits for actual PID disappearance and stays bounded', async t => {
	let now = 0;
	let checks = 0;
	const operations = {
		exists: () => ++checks < 3,
		wait: async (ms: number) => {
			now += ms;
		},
		now: () => now,
	};
	await waitForProcessExit(10, operations);
	t.is(checks, 3);
	await t.throwsAsync(
		waitForProcessExit(10, {...operations, exists: () => true}),
		{message: 'Terminal process was not reaped'},
	);
	t.true(now <= 1050);
});

test('TERM-07 empty or partial process snapshots cannot prove cleanup', async t => {
	for (const table of ['', '10 1 10 S ttys123\npartial']) {
		const value = fixture(() => table);
		await t.throwsAsync(
			stopPosixTree(
				10,
				'/dev/ttys123',
				{pids: [10], groups: [10]},
				value.operations,
			),
			{message: 'Invalid process snapshot'},
		);
		t.true(
			value.signals.some(
				([pid, signal]) => pid === -10 && signal === 'SIGKILL',
			),
		);
	}
});
