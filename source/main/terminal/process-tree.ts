import {execFile} from 'node:child_process';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {canonicalPath, isInside} from '@/main/paths';

const run = promisify(execFile);

export interface TerminalProcesses {
	pids: number[];
	groups: number[];
}

export async function captureTerminalProcesses(
	pid: number,
	roots: readonly string[],
	terminal: string | undefined,
): Promise<TerminalProcesses> {
	if (process.platform === 'win32' || !terminal)
		return {pids: [pid], groups: [pid]};
	const tty = terminal.replace(/^\/dev\//u, '');
	if (!/^(?:ttys?\w+|pts\/\d+)$/u.test(tty))
		throw new Error('Invalid terminal identity');
	const executable = await canonicalPath('/bin/ps');
	if (isInside(executable, roots)) throw new Error('Unsafe system executable');
	let output = '';
	try {
		const result = await run(
			executable,
			['-t', tty, '-o', 'pid=,ppid=,pgid=,tty='],
			{
				shell: false,
				timeout: 750,
				maxBuffer: 262_144,
			},
		);
		output = result.stdout;
	} catch (error) {
		if ((error as {code?: number}).code !== 1) throw error;
	}
	return terminalProcesses(pid, terminal, output);
}

export function descendantPids(root: number, table: string): number[] {
	const children = new Map<number, number[]>();
	for (const line of table.split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
		if (!match) continue;
		const pid = Number(match[1]);
		const parent = Number(match[2]);
		if (pid > 1) children.set(parent, [...(children.get(parent) ?? []), pid]);
	}
	const found = new Set<number>([root]);
	const walk = (pid: number) => {
		for (const child of children.get(pid) ?? []) {
			if (found.has(child)) continue;
			found.add(child);
			walk(child);
		}
	};
	walk(root);
	return [...found].reverse();
}

export async function terminateTree(
	pid: number,
	roots: readonly string[],
	terminal?: string,
	known: TerminalProcesses = {pids: [], groups: []},
): Promise<void> {
	if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
		throw new Error('Invalid terminal process');
	const candidate =
		process.platform === 'win32'
			? path.win32.join(
					process.env.SystemRoot ?? 'C:\\Windows',
					'System32',
					'taskkill.exe',
				)
			: '/bin/ps';
	const executable = await canonicalPath(candidate);
	if (isInside(executable, roots)) throw new Error('Unsafe system executable');
	if (process.platform === 'win32') {
		await run(executable, ['/PID', String(pid), '/T', '/F'], {
			shell: false,
			windowsHide: true,
			timeout: 3500,
			maxBuffer: 65_536,
		}).catch(error => {
			if (alive(pid)) throw error;
		});
		return;
	}
	await stopPosixTree(pid, terminal, known, {
		read: async timeout => {
			const {stdout} = await run(
				executable,
				['-axo', 'pid=,ppid=,pgid=,stat=,tty='],
				{
					shell: false,
					timeout,
					maxBuffer: 4_194_304,
				},
			);
			return stdout;
		},
		signal,
		wait: delay,
		now: () => performance.now(),
	});
}

interface ProcessRow {
	pid: number;
	parent: number;
	group: number;
	state: string;
	tty: string;
}

function processRows(table: string): ProcessRow[] {
	const lines = table.split('\n').filter(line => line.trim());
	if (!lines.length) throw new Error('Invalid process snapshot');
	return lines.map(line => {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/u.exec(line);
		if (!match) throw new Error('Invalid process snapshot');
		return {
			pid: Number(match[1]),
			parent: Number(match[2]),
			group: Number(match[3]),
			state: match[4],
			tty: match[5],
		};
	});
}

export async function stopPosixTree(
	pid: number,
	terminal: string | undefined,
	known: TerminalProcesses,
	operations: {
		read(timeout: number): Promise<string>;
		signal(pid: number, signal: NodeJS.Signals): void;
		wait(ms: number): Promise<void>;
		now(): number;
	},
): Promise<void> {
	if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
		throw new Error('Invalid terminal process');
	const deadline = operations.now() + 2000;
	const pids = new Set([
		pid,
		...known.pids.filter(value => value > 1 && value !== process.pid),
	]);
	const groups = new Set([pid, ...known.groups.filter(value => value > 1)]);
	const stopped = new Set<number>();
	const read = async () =>
		processRows(
			await operations.read(
				Math.max(1, Math.min(750, Math.floor(deadline - operations.now()))),
			),
		);
	const live = (entry: ProcessRow) => !/^[ZX]/u.test(entry.state);
	const retain = (entries: ProcessRow[]) => {
		const rootLive = entries.some(
			entry =>
				entry.pid === pid &&
				live(entry) &&
				entry.tty === terminal?.replace(/^\/dev\//u, ''),
		);
		const table = entries
			.map(entry => `${entry.pid} ${entry.parent} ${entry.group} ${entry.tty}`)
			.join('\n');
		const members = terminalProcesses(
			pid,
			rootLive ? terminal : undefined,
			table,
		);
		const parents = entries
			.map(entry => `${entry.pid} ${entry.parent}`)
			.join('\n');
		for (const seed of pids)
			for (const child of descendantPids(seed, parents))
				members.pids.push(child);
		for (const entry of entries)
			if (groups.has(entry.group)) members.pids.push(entry.pid);
		for (const child of members.pids)
			if (child > 1 && child !== process.pid) pids.add(child);
		for (const entry of entries)
			if (pids.has(entry.pid) && entry.group > 1) groups.add(entry.group);
	};
	const attempt = (target: number, value: NodeJS.Signals): boolean => {
		try {
			operations.signal(target, value);
			return true;
		} catch {
			return false;
		}
	};
	let discoveryError: unknown;
	try {
		retain(await read());
		for (const group of groups) attempt(-group, 'SIGHUP');
		// A production grace deadline, not a test sleep.
		await operations.wait(200);
		retain(await read());
	} catch (error) {
		discoveryError = error;
	}
	for (const target of [...groups]
		.map(group => -group)
		.concat([...pids].reverse())) {
		if (attempt(target, 'SIGSTOP')) stopped.add(target);
	}
	for (const group of groups) attempt(-group, 'SIGKILL');
	for (const child of pids) attempt(child, 'SIGKILL');
	try {
		if (discoveryError) throw discoveryError;
		for (;;) {
			const entries = await read();
			if (
				!entries.some(
					entry =>
						live(entry) && (pids.has(entry.pid) || groups.has(entry.group)),
				)
			)
				return;
			if (operations.now() >= deadline)
				throw new Error('Terminal processes remain alive');
			await operations.wait(Math.min(25, deadline - operations.now()));
		}
	} catch (error) {
		for (const target of stopped) attempt(target, 'SIGCONT');
		throw error;
	}
}

export async function waitForProcessExit(
	pid: number,
	operations: {
		exists(pid: number): boolean;
		wait(ms: number): Promise<void>;
		now(): number;
	} = {exists: alive, wait: delay, now: () => performance.now()},
): Promise<void> {
	const deadline = operations.now() + 1000;
	while (operations.exists(pid)) {
		if (operations.now() >= deadline)
			throw new Error('Terminal process was not reaped');
		await operations.wait(Math.min(25, deadline - operations.now()));
	}
}

export function terminalProcesses(
	root: number,
	terminal: string | undefined,
	table: string,
): TerminalProcesses {
	const entries = table.split('\n').flatMap(line => {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/u.exec(line);
		return match
			? [
					{
						pid: Number(match[1]),
						parent: Number(match[2]),
						group: Number(match[3]),
						tty: match[4],
					},
				]
			: [];
	});
	const pids = new Set(
		descendantPids(
			root,
			entries.map(value => `${value.pid} ${value.parent}`).join('\n'),
		),
	);
	const tty = terminal?.replace(/^\/dev\//u, '');
	const validTty =
		tty &&
		/^(?:ttys?\w+|pts\/\d+)$/u.test(tty) &&
		entries.some(entry => entry.pid === root && entry.tty === tty);
	for (const entry of entries)
		if (validTty && entry.tty === tty) pids.add(entry.pid);
	pids.delete(process.pid);
	const groups = new Set(
		entries
			.filter(value => pids.has(value.pid) && value.group > 1)
			.map(value => value.group),
	);
	return {pids: [...pids].filter(value => value > 1), groups: [...groups]};
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== 'ESRCH';
	}
}

function signal(pid: number, value: NodeJS.Signals): void {
	try {
		process.kill(pid, value);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
	}
}
