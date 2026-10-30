import path from 'node:path';
import {utilityProcess} from 'electron';
import {IpcFailure} from '@/main/ipc/handle-request';
import {terminateTree} from '@/main/terminal/process-tree';
import type {
	PtyHostFactory,
	WorkerCommand,
	WorkerEvent,
} from '@/main/terminal/pty-contracts';
import {terminalEnvironment} from '@/main/terminal/shell';

export const createUtilityPtyHost: PtyHostFactory = async (launch, events) => {
	const worker = utilityProcess.fork(
		path.join(import.meta.dirname, 'pty-worker.js'),
		[],
		{
			env: terminalEnvironment(process.env),
			execArgv: [],
			stdio: 'ignore',
			serviceName: 'Nanocoder project terminal',
		},
	);
	let pid: number | undefined;
	let ended = false;
	let stopping: Promise<void> | undefined;
	let resolveReady!: () => void;
	let rejectReady!: (error: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const send = (command: WorkerCommand) => worker.postMessage(command);
	const failure = () =>
		new IpcFailure('UNAVAILABLE', 'The terminal process could not run');
	const stop = (): Promise<void> => {
		if (stopping) return stopping;
		stopping = (async () => {
			ended = true;
			clearTimeout(deadline);
			if (pid !== undefined) await terminateTree(pid, launch.roots);
			worker.kill();
		})();
		return stopping;
	};
	const fail = () => {
		rejectReady(failure());
		if (!ended) {
			void stop().then(
				() => events.exit(null, true),
				() => events.exit(null, true),
			);
		}
	};
	const deadline = setTimeout(fail, 5000);
	worker.on('message', (event: WorkerEvent) => {
		if (ended) return;
		switch (event.type) {
			case 'ready':
				pid = event.pid;
				clearTimeout(deadline);
				resolveReady();
				break;
			case 'data':
				events.data(event.data);
				send({type: 'ack'});
				break;
			case 'exit':
				void stop().then(
					() => events.exit(event.code, false),
					() => events.exit(event.code, true),
				);
				break;
			case 'failed':
				fail();
				break;
		}
	});
	worker.once('exit', fail);
	worker.once('spawn', () => send({type: 'start', launch}));
	try {
		await ready;
	} catch {
		await stop();
		throw failure();
	}
	return {
		write: data => {
			if (ended) throw failure();
			try {
				send({type: 'write', data});
			} catch {
				throw failure();
			}
		},
		resize: (cols, rows) => {
			if (ended) throw failure();
			try {
				send({type: 'resize', cols, rows});
			} catch {
				throw failure();
			}
		},
		stop,
	};
};
