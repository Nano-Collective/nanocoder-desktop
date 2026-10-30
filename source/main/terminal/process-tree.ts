import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {canonicalPath, isInside} from '@/main/paths';

const run = promisify(execFile);

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
	const {stdout} = await run(executable, ['-axo', 'pid=,ppid='], {
		shell: false,
		timeout: 1500,
		maxBuffer: 4_194_304,
	});
	// Freeze the tree before killing leaves so children cannot fork during teardown.
	const pids = descendantPids(pid, stdout);
	for (const child of [...pids].reverse()) signal(child, 'SIGSTOP');
	for (const child of pids) signal(child, 'SIGKILL');
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
