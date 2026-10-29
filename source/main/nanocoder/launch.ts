import {
	type ChildProcess,
	type ChildProcessByStdio,
	spawn,
} from 'node:child_process';
import path from 'node:path';
import type {Readable, Writable} from 'node:stream';
import type {NanocoderRuntime} from '@/shared/ipc';

const BLOCKED_ENV = new Set([
	'NODE_OPTIONS',
	'ELECTRON_RUN_AS_NODE',
	// Set only by the trust launch (DEC-30), never inherited from a shell.
	'NANOCODER_TRUST_DIRECTORY',
]);

export interface Exit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(env).filter(([key]) => !BLOCKED_ENV.has(key.toUpperCase())),
	);
}

export function launchNanocoder(
	runtime: Pick<NanocoderRuntime, 'nodePath' | 'cliPath'>,
	args: readonly string[],
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
	{trustDirectory = false}: {trustDirectory?: boolean} = {},
): ChildProcessByStdio<Writable, Readable, Readable> {
	if (
		![runtime.nodePath, runtime.cliPath, cwd].every(value =>
			path.isAbsolute(value),
		)
	) {
		throw new Error('Nanocoder launch paths must be absolute');
	}
	if (
		args.some(
			arg =>
				arg === '--trust-directory' || arg.startsWith('--trust-directory='),
		)
	) {
		throw new Error('Directory trust must use the confirmed trust launch');
	}
	const clean = childEnv(env);
	return spawn(runtime.nodePath, [runtime.cliPath, ...args], {
		cwd,
		env: trustDirectory ? {...clean, NANOCODER_TRUST_DIRECTORY: '1'} : clean,
		shell: false,
		windowsHide: true,
		stdio: ['pipe', 'pipe', 'pipe'],
	});
}

export function waitForExit(child: ChildProcess): Promise<Exit> {
	return new Promise(resolve => {
		const done = () =>
			resolve(
				child.pid === undefined
					? {code: null, signal: null}
					: {code: child.exitCode, signal: child.signalCode},
			);
		child.once('close', done);
		child.once('error', done);
	});
}
