import {
	type ChildProcess,
	type ChildProcessByStdio,
	type SpawnOptionsWithStdioTuple,
	spawn as spawnChild,
} from 'node:child_process';
import {type BigIntStats, statSync} from 'node:fs';
import path from 'node:path';
import type {Readable, Writable} from 'node:stream';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {requiresTrustPreflight} from '@/main/nanocoder/version-policy';
import {canonicalPathSync} from '@/main/paths';
import type {NanocoderRuntime} from '@/shared/ipc';

type LaunchRuntime = Pick<NanocoderRuntime, 'nodePath' | 'cliPath'> &
	Partial<Pick<NanocoderRuntime, 'version' | 'source'>>;
type Spawn = (
	command: string,
	args: readonly string[],
	options: SpawnOptionsWithStdioTuple<'pipe', 'pipe', 'pipe'>,
) => ChildProcessByStdio<Writable, Readable, Readable>;
interface IdentityFs {
	realpath: (file: string) => string;
	stat: (
		file: string,
	) => Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'isFile'>;
}
const identityFs: IdentityFs = {
	realpath: canonicalPathSync,
	stat: file => statSync(file, {bigint: true}),
};
export interface LaunchIdentity {
	key: string;
	fingerprint: string;
}
export function captureLaunchIdentity(
	runtime: LaunchRuntime,
	fs: IdentityFs = identityFs,
): LaunchIdentity {
	const paths = [runtime.cliPath, runtime.nodePath].map(file =>
		fs.realpath(file),
	);
	const files = paths.map(file => fs.stat(file));
	if (files.some(file => !file.isFile()))
		throw new Error('Runtime is not a file');
	return {
		key: JSON.stringify([...paths, runtime.version]),
		fingerprint: JSON.stringify(
			files.map(file =>
				[file.dev, file.ino, file.size, file.mtimeNs].map(String),
			),
		),
	};
}
const bindings = new WeakMap<object, LaunchIdentity>();
export function bindLaunchIdentity<T extends LaunchRuntime>(
	runtime: T,
	identity: LaunchIdentity,
): T {
	const bound = {...runtime};
	bindings.set(bound, {...identity});
	return bound;
}

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

export function createNanocoderLauncher(
	options: {fs?: IdentityFs; spawn?: Spawn} = {},
) {
	const spawn = options.spawn ?? spawnChild;
	return function launchNanocoder(
		runtime: LaunchRuntime,
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
		const spawnOptions = {
			cwd,
			env: trustDirectory ? {...clean, NANOCODER_TRUST_DIRECTORY: '1'} : clean,
			shell: false as const,
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
		};
		const expected = bindings.get(runtime);
		if (expected || requiresTrustPreflight(runtime.version ?? null)) {
			let current: LaunchIdentity;
			try {
				current = captureLaunchIdentity(runtime, options.fs);
			} catch {
				throw new NanocoderFailure(
					'UNSUPPORTED',
					'Nanocoder executable identity changed or could not be verified. Retry with a verified development build.',
				);
			}
			if (
				!expected ||
				current.key !== expected.key ||
				current.fingerprint !== expected.fingerprint
			)
				throw new NanocoderFailure(
					'UNSUPPORTED',
					'Nanocoder executable identity changed or was not verified. Retry with a verified development build.',
				);
		}
		return spawn(runtime.nodePath, [runtime.cliPath, ...args], spawnOptions);
	};
}
export const launchNanocoder = createNanocoderLauncher();

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
