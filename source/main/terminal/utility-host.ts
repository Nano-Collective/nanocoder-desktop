import path from 'node:path';
import {utilityProcess} from 'electron';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	captureTerminalProcesses,
	type TerminalProcesses,
	terminateTree,
	waitForProcessExit,
} from '@/main/terminal/process-tree';
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
	let terminal: string | undefined;
	let ended = false;
	let workerEnded = false;
	let resolveWorkerExit!: () => void;
	const workerExit = new Promise<void>(resolve => {
		resolveWorkerExit = resolve;
	});
	let epoch = 0;
	let known: TerminalProcesses = {pids: [], groups: []};
	let capture: Promise<void> = Promise.resolve();
	let monitor: ReturnType<typeof setInterval> | undefined;
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
	const refresh = (): Promise<void> => {
		capture = capture.then(async () => {
			if (pid === undefined || ended) return;
			const current = await captureTerminalProcesses(
				pid,
				launch.roots,
				terminal,
			);
			if (current.groups.length) known = current;
		});
		return capture;
	};
	const stop = (): Promise<void> => {
		if (stopping) return stopping;
		stopping = (async () => {
			ended = true;
			clearTimeout(deadline);
			clearInterval(monitor);
			await capture.catch(() => {});
			if (pid !== undefined)
				await terminateTree(pid, launch.roots, terminal, known);
			if (!workerEnded) worker.kill();
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					workerExit,
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => reject(failure()), 1000);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
			if (pid !== undefined) await waitForProcessExit(pid);
		})().catch(error => {
			stopping = undefined;
			throw error;
		});
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
	const deadline = setTimeout(fail, 2000);
	worker.on('message', (event: WorkerEvent) => {
		if (ended) return;
		switch (event.type) {
			case 'ready':
				pid = event.pid;
				terminal = event.terminal;
				clearTimeout(deadline);
				void refresh().then(() => {
					if (ended) return;
					monitor = setInterval(() => {
						void refresh().catch(fail);
					}, 250);
					resolveReady();
				}, fail);
				break;
			case 'data':
				void refresh().then(() => {
					if (ended) return;
					if (event.epoch === epoch) events.data(event.data);
					send({type: 'ack'});
				}, fail);
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
	worker.once('exit', () => {
		workerEnded = true;
		resolveWorkerExit();
		fail();
	});
	worker.once('spawn', () => {
		if (ended) worker.kill();
		else send({type: 'start', launch});
	});
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
		clear: () => {
			if (ended) return;
			try {
				send({type: 'clear', epoch: ++epoch});
			} catch {
				throw failure();
			}
		},
		stop,
	};
};
