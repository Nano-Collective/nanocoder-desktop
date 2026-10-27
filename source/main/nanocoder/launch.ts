import {type ChildProcessByStdio, spawn} from 'node:child_process';
import type {Readable, Writable} from 'node:stream';
import type {NanocoderRuntime} from '@/shared/ipc';

const BLOCKED_ENV = new Set([
	'NODE_OPTIONS',
	'ELECTRON_RUN_AS_NODE',
	// Trust is the desktop's decision (OQ-14), never inherited from a shell.
	'NANOCODER_TRUST_DIRECTORY',
]);

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
): ChildProcessByStdio<Writable, Readable, Readable> {
	return spawn(runtime.nodePath, [runtime.cliPath, ...args], {
		cwd,
		env: childEnv(env),
		shell: false,
		windowsHide: true,
		stdio: ['pipe', 'pipe', 'pipe'],
	});
}
