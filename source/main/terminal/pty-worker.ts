import {createRequire} from 'node:module';
import type {IPty} from 'node-pty';
import {canonicalPath, isInside} from '@/main/paths';
import type {WorkerCommand, WorkerEvent} from '@/main/terminal/pty-contracts';

const port = process.parentPort;
if (!port) throw new Error('The terminal requires a utility process');
const send = (event: WorkerEvent) => port.postMessage(event);
let pty: IPty | undefined;
let pending = '';
let awaitingAck = false;
let flush: ReturnType<typeof setTimeout> | undefined;
let exitCode: number | undefined;
let epoch = 0;

function finish(): void {
	if (exitCode !== undefined && !pending && !awaitingAck)
		send({type: 'exit', code: exitCode});
}

function schedule(): void {
	if (flush || awaitingAck || !pending) return;
	flush = setTimeout(() => {
		flush = undefined;
		if (!pending) return;
		const data = pending;
		pending = '';
		awaitingAck = true;
		send({type: 'data', data, epoch});
	}, 16);
}

port.on('message', async ({data}: {data: WorkerCommand}) => {
	try {
		switch (data.type) {
			case 'start': {
				if (pty) throw new Error();
				// Load native code only in this isolated process.
				const native = createRequire(import.meta.url)(
					'node-pty',
				) as typeof import('node-pty');
				const {launch} = data;
				if (
					(await canonicalPath(launch.root)) !== launch.root ||
					(await canonicalPath(launch.shell.file)) !== launch.shell.file ||
					isInside(launch.shell.file, launch.roots)
				)
					throw new Error();
				pty = native.spawn(launch.shell.file, launch.shell.args, {
					name: 'xterm-256color',
					cwd: launch.root,
					env: launch.env,
					cols: launch.cols,
					rows: launch.rows,
					encoding: 'utf8',
				});
				const terminal =
					'ptsName' in pty && typeof pty.ptsName === 'string'
						? pty.ptsName
						: undefined;
				send({type: 'ready', pid: pty.pid, terminal});
				pty.onData(chunk => {
					pending += chunk;
					if (pending.length > 65_536)
						pending = `[terminal output truncated]\r\n${pending.slice(-60_000)}`;
					pty?.pause();
					schedule();
				});
				pty.onExit(event => {
					exitCode = event.exitCode;
					schedule();
					finish();
				});
				break;
			}
			case 'write':
				pty?.write(data.data);
				break;
			case 'resize':
				pty?.resize(data.cols, data.rows);
				break;
			case 'clear':
				epoch = data.epoch;
				pending = '';
				clearTimeout(flush);
				flush = undefined;
				pty?.clear();
				if (!awaitingAck && exitCode === undefined) pty?.resume();
				break;
			case 'ack':
				awaitingAck = false;
				if (pending) schedule();
				else {
					finish();
					if (exitCode === undefined) pty?.resume();
				}
		}
	} catch {
		send({type: 'failed'});
	}
});
