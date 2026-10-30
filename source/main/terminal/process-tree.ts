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
	const snapshot = async () => {
		const {stdout} = await run(executable, ['-axo', 'pid=,ppid=,pgid=,tty='], {
			shell: false,
			timeout: 1000,
			maxBuffer: 4_194_304,
		});
		return terminalProcesses(pid, terminal, stdout);
	};
	const initial = await snapshot();
	for (const group of new Set([...known.groups, ...initial.groups, pid]))
		signal(-group, 'SIGHUP');
	// A production grace deadline, not a test sleep.
	await delay(200);
	const final = await snapshot();
	const pids = new Set([...known.pids, ...initial.pids, ...final.pids]);
	const groups = new Set([
		...known.groups,
		...initial.groups,
		...final.groups,
		pid,
	]);
	for (const group of groups) signal(-group, 'SIGSTOP');
	for (const child of [...pids].reverse()) signal(child, 'SIGSTOP');
	for (const group of groups) signal(-group, 'SIGKILL');
	for (const child of pids) signal(child, 'SIGKILL');
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
	const validTty = tty && /^(?:ttys?\w+|pts\/\d+)$/u.test(tty);
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
	} catch {
		return false;
	}
}

function signal(pid: number, value: NodeJS.Signals): void {
	try {
		process.kill(pid, value);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
	}
}
