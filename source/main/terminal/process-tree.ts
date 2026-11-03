import {execFile} from 'node:child_process';
import path from 'node:path';
import {
	setTimeout as delay,
	setImmediate as yieldTurn,
} from 'node:timers/promises';
import {promisify} from 'node:util';
import {canonicalPath, isInside} from '@/main/paths';

const run = promisify(execFile);
const columns = 'pid=,ppid=,pgid=,stat=,tty=,lstart=';

export interface ProcessIdentity {
	pid: number;
	started: string;
	tty: string;
}
interface ProcessRow extends ProcessIdentity {
	parent: number;
	group: number;
	state: string;
}
export interface TerminalProcesses {
	root: ProcessIdentity | null;
	members: ProcessIdentity[];
}
export interface ProcessOperations {
	read(timeout: number): Promise<string>;
	probe(pid: number, timeout: number): Promise<string>;
	signal(pid: number, signal: NodeJS.Signals): void;
	wait(ms: number): Promise<void>;
	yield(): Promise<void>;
	now(): number;
}
interface Snapshot {
	rows: Map<number, ProcessRow>;
	children: Map<number, ProcessRow[]>;
}

function budget(
	operations: Pick<ProcessOperations, 'now'>,
	deadline: number,
): number {
	const left = Math.floor(deadline - operations.now());
	if (left <= 0) throw new Error('Terminal cleanup deadline exceeded');
	return Math.min(750, left);
}
function row(line: string): ProcessRow {
	const match =
		/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/u.exec(
			line,
		);
	if (!match) throw new Error('Invalid process snapshot');
	if (!match.slice(1, 4).every(value => Number.isSafeInteger(Number(value))))
		throw new Error('Invalid process snapshot');
	return {
		pid: Number(match[1]),
		parent: Number(match[2]),
		group: Number(match[3]),
		state: match[4],
		tty: match[5],
		started: match[6].replace(/\s+/gu, ' '),
	};
}
function identity(value: ProcessRow): ProcessIdentity {
	return {pid: value.pid, started: value.started, tty: value.tty};
}
function sameProcess(value: ProcessRow, expected: ProcessIdentity): boolean {
	return value.pid === expected.pid && value.started === expected.started;
}
function matches(value: ProcessRow, expected: ProcessIdentity): boolean {
	// Hangup can clear a captured process's tty, but cannot change its identity.
	return (
		sameProcess(value, expected) &&
		(value.tty === expected.tty || /^(?:\?{1,2}|-)$/u.test(value.tty))
	);
}
function live(value: ProcessRow): boolean {
	return !/^[ZX]/u.test(value.state);
}
async function checkpoint(
	index: number,
	operations: ProcessOperations,
	deadline: number,
): Promise<void> {
	if (index % 64) return;
	budget(operations, deadline);
	await operations.yield();
	budget(operations, deadline);
}
async function snapshot(
	table: string,
	operations: ProcessOperations,
	deadline: number,
): Promise<Snapshot> {
	const lines = table.split('\n').filter(line => line.trim());
	if (!lines.length) throw new Error('Invalid process snapshot');
	const rows = new Map<number, ProcessRow>();
	const children = new Map<number, ProcessRow[]>();
	for (let index = 0; index < lines.length; ++index) {
		await checkpoint(index, operations, deadline);
		const value = row(lines[index]);
		if (rows.has(value.pid)) throw new Error('Invalid process snapshot');
		rows.set(value.pid, value);
		let siblings = children.get(value.parent);
		if (!siblings) {
			siblings = [];
			children.set(value.parent, siblings);
		}
		siblings.push(value);
	}
	return {rows, children};
}
async function owned(
	current: Snapshot,
	known: Map<number, ProcessIdentity>,
	tty: string,
	operations: ProcessOperations,
	deadline: number,
): Promise<ProcessRow[]> {
	const found = new Map<number, ProcessRow>();
	let visited = 0;
	for (const expected of known.values()) {
		await checkpoint(visited++, operations, deadline);
		const value = current.rows.get(expected.pid);
		if (value && value.pid !== process.pid && matches(value, expected))
			found.set(value.pid, value);
	}
	const queue = [...found.values()];
	for (let index = 0; index < queue.length; ++index) {
		await checkpoint(index, operations, deadline);
		for (const child of current.children.get(queue[index].pid) ?? []) {
			await checkpoint(visited++, operations, deadline);
			if (
				child.pid <= 1 ||
				child.pid === process.pid ||
				child.tty !== tty ||
				found.has(child.pid)
			)
				continue;
			found.set(child.pid, child);
			queue.push(child);
		}
	}
	return [...found.values()];
}
async function fresh(
	expected: ProcessIdentity,
	operations: ProcessOperations,
	deadline: number,
): Promise<ProcessRow | null> {
	const output = await operations.probe(
		expected.pid,
		budget(operations, deadline),
	);
	budget(operations, deadline);
	if (!output.trim()) return null;
	const value = row(output.trim());
	return matches(value, expected) ? value : null;
}
async function send(
	expected: ProcessIdentity,
	signal: NodeJS.Signals,
	operations: ProcessOperations,
	deadline: number,
	frozenOnly = false,
): Promise<ProcessRow | null> {
	if (
		!Number.isSafeInteger(expected.pid) ||
		expected.pid <= 1 ||
		expected.pid === process.pid
	)
		return null;
	const value = await fresh(expected, operations, deadline);
	if (!value || !live(value)) return null;
	if (frozenOnly && !/^[Tt]/u.test(value.state)) return null;
	budget(operations, deadline);
	try {
		operations.signal(value.pid, signal);
		return value;
	} catch {
		return null;
	}
}

export async function stopPosixTree(
	known: TerminalProcesses,
	operations: ProcessOperations,
): Promise<void> {
	const root = known.root;
	if (
		!root ||
		!Number.isSafeInteger(root.pid) ||
		root.pid <= 1 ||
		root.pid === process.pid
	)
		throw new Error('Invalid terminal process identity');
	const deadline = operations.now() + 2000;
	const tracked = new Map(known.members.map(value => [value.pid, value]));
	tracked.set(root.pid, root);
	const stopped = new Map<number, ProcessIdentity>();
	const readOwned = async () => {
		const current = await snapshot(
			await operations.read(budget(operations, deadline)),
			operations,
			deadline,
		);
		const values = await owned(
			current,
			tracked,
			root.tty,
			operations,
			deadline,
		);
		for (const value of values) {
			const previous = tracked.get(value.pid);
			if (!previous || !sameProcess(value, previous))
				tracked.set(value.pid, identity(value));
		}
		return values.filter(live);
	};
	try {
		for (;;) {
			const before = await readOwned();
			const keys = new Set(
				before.map(value => `${value.pid}/${value.started}`),
			);
			for (const value of before) {
				if (/^[Tt]/u.test(value.state)) continue;
				const expected = tracked.get(value.pid);
				if (!expected) continue;
				const sent = await send(expected, 'SIGSTOP', operations, deadline);
				if (sent && !/^[Tt]/u.test(sent.state))
					stopped.set(value.pid, expected);
			}
			const frozen = await readOwned();
			if (
				frozen.some(
					value =>
						!/^[Tt]/u.test(value.state) ||
						!keys.has(`${value.pid}/${value.started}`),
				)
			) {
				await operations.wait(Math.min(25, budget(operations, deadline)));
				continue;
			}
			// Keep parents frozen and alive until late children have been captured.
			for (const value of frozen.reverse()) {
				const expected = tracked.get(value.pid);
				if (expected)
					await send(expected, 'SIGKILL', operations, deadline, true);
			}
			if (!(await readOwned()).length) return;
			await operations.wait(Math.min(25, budget(operations, deadline)));
		}
	} catch (error) {
		const cleanupDeadline = operations.now() + 2000;
		for (const expected of stopped.values()) {
			if (operations.now() >= cleanupDeadline) break;
			try {
				await send(expected, 'SIGCONT', operations, cleanupDeadline);
			} catch {}
		}
		throw error;
	}
}

async function query(
	executable: string,
	args: string[],
	timeout: number,
	allowEmpty = false,
): Promise<string> {
	try {
		const {stdout} = await run(executable, args, {
			shell: false,
			timeout,
			maxBuffer: 4_194_304,
			env: {PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC'},
		});
		return stdout;
	} catch (error) {
		if (
			allowEmpty &&
			(error as {code?: number}).code === 1 &&
			!(error as {stderr?: string}).stderr?.trim()
		)
			return '';
		throw error;
	}
}
function systemOperations(executable: string): ProcessOperations {
	return {
		read: timeout => query(executable, ['-axo', columns], timeout),
		probe: (pid, timeout) =>
			query(executable, ['-p', String(pid), '-o', columns], timeout, true),
		signal: (pid, signal) => {
			process.kill(pid, signal);
		},
		wait: delay,
		yield: () => yieldTurn(),
		now: () => performance.now(),
	};
}
async function systemPs(roots: readonly string[]): Promise<string> {
	const executable = await canonicalPath('/bin/ps');
	if (isInside(executable, roots)) throw new Error('Unsafe system executable');
	return executable;
}

export async function captureTerminalProcesses(
	pid: number,
	roots: readonly string[],
	terminal: string | undefined,
	previous: TerminalProcesses = {root: null, members: []},
	retainRoot?: (root: ProcessIdentity) => void,
): Promise<TerminalProcesses> {
	if (process.platform === 'win32') return previous;
	const tty = terminal?.replace(/^\/dev\//u, '');
	if (!tty || !/^(?:ttys?\w+|pts\/\d+)$/u.test(tty))
		throw new Error('Invalid terminal identity');
	const executable = await systemPs(roots);
	const operations = systemOperations(executable);
	const deadline = operations.now() + 750;
	let root = previous.root;
	if (!root) {
		let expected: ProcessIdentity | undefined;
		for (;;) {
			const output = await operations.probe(pid, budget(operations, deadline));
			if (!output.trim())
				throw new Error('Terminal process identity unavailable');
			const value = row(output.trim());
			if (value.pid !== pid || (expected && !sameProcess(value, expected)))
				throw new Error('Terminal process identity unavailable');
			expected ??= {...identity(value), tty};
			if (value.tty === tty) {
				root = expected;
				retainRoot?.(root);
				break;
			}
			if (!/^(?:\?{1,2}|-)$/u.test(value.tty))
				throw new Error('Terminal process identity unavailable');
			await operations.wait(Math.min(25, budget(operations, deadline)));
		}
	}
	const output = await query(
		executable,
		['-t', tty, '-o', columns],
		budget(operations, deadline),
		true,
	);
	if (!output.trim()) {
		if (previous.root) return previous;
		throw new Error('Terminal process identity unavailable');
	}
	const current = await snapshot(output, operations, deadline);
	const rootRow = current.rows.get(pid);
	if (
		!rootRow ||
		rootRow.tty !== tty ||
		(previous.root && !sameProcess(rootRow, previous.root))
	) {
		if (previous.root) return previous;
		throw new Error('Terminal process identity unavailable');
	}
	const tracked = new Map(previous.members.map(value => [value.pid, value]));
	tracked.set(pid, root);
	const members = (
		await owned(current, tracked, tty, operations, deadline)
	).map(identity);
	return {root, members};
}

export async function waitForProcessExit(
	expected: ProcessIdentity,
	operations: ProcessOperations,
): Promise<void> {
	const deadline = operations.now() + 1000;
	for (;;) {
		const output = await operations.probe(
			expected.pid,
			budget(operations, deadline),
		);
		if (!output.trim() || !sameProcess(row(output.trim()), expected)) return;
		await operations.wait(Math.min(25, budget(operations, deadline)));
	}
}

export async function terminateTree(
	pid: number,
	roots: readonly string[],
	_terminal?: string,
	known: TerminalProcesses = {root: null, members: []},
): Promise<void> {
	if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
		throw new Error('Invalid terminal process');
	if (process.platform === 'win32') {
		const executable = await canonicalPath(
			path.win32.join(
				process.env.SystemRoot ?? 'C:\\Windows',
				'System32',
				'taskkill.exe',
			),
		);
		if (isInside(executable, roots))
			throw new Error('Unsafe system executable');
		await run(executable, ['/PID', String(pid), '/T', '/F'], {
			shell: false,
			windowsHide: true,
			timeout: 3500,
			maxBuffer: 65_536,
		}).catch(error => {
			try {
				process.kill(pid, 0);
			} catch (caught) {
				if ((caught as NodeJS.ErrnoException).code === 'ESRCH') return;
			}
			throw error;
		});
		return;
	}
	const executable = await systemPs(roots);
	if (known.root?.pid !== pid)
		throw new Error('Terminal process identity unavailable');
	const operations = systemOperations(executable);
	await stopPosixTree(known, operations);
	// Let the native worker reap its own shell before main terminates the worker.
	await waitForProcessExit(known.root, operations);
}
