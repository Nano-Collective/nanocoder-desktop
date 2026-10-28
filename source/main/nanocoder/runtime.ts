import {execFile} from 'node:child_process';
import {accessSync, constants, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {childEnv} from '@/main/nanocoder/launch';
import {canonicalPathSync, isInside} from '@/main/paths';
import type {NanocoderRuntime} from '@/shared/ipc';

const PACKAGE_NAME = '@nanocollective/nanocoder';
const MIN_NODE_MAJOR = 22;
const MAX_SHIM_BYTES = 64 * 1024;

export type Resolution =
	| {ok: true; runtime: NanocoderRuntime}
	| {ok: false; code: 'NOT_FOUND' | 'DENIED' | 'UNSUPPORTED'; message: string};

export interface ResolveOptions {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
	untrustedRoots: readonly string[];
	signal?: AbortSignal;
	readNodeVersion?: (nodePath: string, signal?: AbortSignal) => Promise<string>;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const key = Object.keys(env).find(k => k.toUpperCase() === name);
	return key ? env[key] : undefined;
}

// Relative entries resolve against the working directory, so they are dropped.
export function pathDirectories(env: NodeJS.ProcessEnv): string[] {
	return (envValue(env, 'PATH') ?? '')
		.split(path.delimiter)
		.filter(dir => dir !== '' && path.isAbsolute(dir));
}

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
	try {
		if (!statSync(file).isFile()) return false;
		if (platform !== 'win32') accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function findOnPath(
	names: readonly string[],
	dirs: readonly string[],
	platform: NodeJS.Platform,
): string | undefined {
	for (const dir of dirs) {
		for (const name of names) {
			const candidate = path.join(dir, name);
			if (isExecutableFile(candidate, platform)) return candidate;
		}
	}
	return undefined;
}

export function cliFromShim(shimPath: string): string | undefined {
	let text: string;
	try {
		if (statSync(shimPath).size > MAX_SHIM_BYTES) return undefined;
		text = readFileSync(shimPath, 'utf8');
	} catch {
		return undefined;
	}
	const match =
		/(?:%~?dp0%?|\$basedir)([\\/][^"'\r\n]*?@nanocollective[\\/]nanocoder[\\/]dist[\\/]cli\.js)/.exec(
			text,
		);
	if (!match) return undefined;
	const parts = match[1].split(/[\\/]/).filter(Boolean);
	return path.resolve(path.dirname(shimPath), ...parts);
}

function locateCli(binPath: string): string | undefined {
	try {
		const real = canonicalPathSync(binPath);
		if (/[\\/]dist[\\/]cli\.js$/.test(real)) return real;
	} catch {
		return undefined;
	}
	const fromShim = cliFromShim(binPath);
	try {
		return fromShim ? canonicalPathSync(fromShim) : undefined;
	} catch {
		return undefined;
	}
}

function readPackageVersion(cliPath: string): string | undefined {
	try {
		const root = path.resolve(cliPath, '..', '..');
		const pkg = JSON.parse(
			readFileSync(path.join(root, 'package.json'), 'utf8'),
		);
		const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.nanocoder;
		if (pkg.name !== PACKAGE_NAME || typeof pkg.version !== 'string') {
			return undefined;
		}
		if (typeof bin !== 'string' || path.resolve(root, bin) !== cliPath) {
			return undefined;
		}
		return pkg.version;
	} catch {
		return undefined;
	}
}

async function defaultNodeVersion(
	nodePath: string,
	signal?: AbortSignal,
): Promise<string> {
	const {stdout} = await promisify(execFile)(nodePath, ['--version'], {
		timeout: 10_000,
		windowsHide: true,
		env: childEnv(process.env),
		signal,
		killSignal: 'SIGKILL',
		shell: false,
	});
	return stdout.trim();
}

export async function resolveNanocoder(
	options: ResolveOptions,
): Promise<Resolution> {
	options.signal?.throwIfAborted();
	const {env, platform} = options;
	let untrustedRoots: string[];
	try {
		untrustedRoots = options.untrustedRoots.map(root => {
			if (!path.isAbsolute(root)) throw new Error('Project root is relative');
			return canonicalPathSync(root);
		});
	} catch {
		return {
			ok: false,
			code: 'DENIED',
			message: 'The project root is unavailable',
		};
	}
	const dirs = pathDirectories(env);
	const exe = (name: string) =>
		platform === 'win32' ? [`${name}.exe`] : [name];

	const cliOverride = envValue(env, 'NANOCODER_DESKTOP_CLI');
	let cliPath: string | undefined;
	if (cliOverride) {
		if (!path.isAbsolute(cliOverride)) {
			return {
				ok: false,
				code: 'DENIED',
				message: 'NANOCODER_DESKTOP_CLI must be an absolute path',
			};
		}
		cliPath = locateCli(cliOverride);
	} else {
		const names =
			platform === 'win32' ? ['nanocoder.cmd', 'nanocoder'] : ['nanocoder'];
		const bin = findOnPath(names, dirs, platform);
		cliPath = bin ? locateCli(bin) : undefined;
	}
	if (!cliPath) {
		return {
			ok: false,
			code: 'NOT_FOUND',
			message: 'Nanocoder is not installed or not on PATH',
		};
	}
	if (isInside(cliPath, untrustedRoots, platform)) {
		return {
			ok: false,
			code: 'DENIED',
			message: 'Refusing a Nanocoder inside the project folder',
		};
	}
	const version = readPackageVersion(cliPath);
	if (!version) {
		return {
			ok: false,
			code: 'DENIED',
			message: `Not a Nanocoder package: ${cliPath}`,
		};
	}

	const nodeOverride = envValue(env, 'NANOCODER_DESKTOP_NODE');
	if (nodeOverride && !path.isAbsolute(nodeOverride)) {
		return {
			ok: false,
			code: 'DENIED',
			message: 'NANOCODER_DESKTOP_NODE must be an absolute path',
		};
	}
	const nodeFound = nodeOverride ?? findOnPath(exe('node'), dirs, platform);
	if (!nodeFound || !isExecutableFile(nodeFound, platform)) {
		return {
			ok: false,
			code: 'NOT_FOUND',
			message: 'Node.js is not installed or not on PATH',
		};
	}
	const nodePath = canonicalPathSync(nodeFound);
	if (isInside(nodePath, untrustedRoots, platform)) {
		return {
			ok: false,
			code: 'DENIED',
			message: 'Refusing a Node.js inside the project folder',
		};
	}

	let nodeVersion: string;
	try {
		nodeVersion = await (options.readNodeVersion ?? defaultNodeVersion)(
			nodePath,
			options.signal,
		);
	} catch {
		return {
			ok: false,
			code: 'UNSUPPORTED',
			message: `Could not run ${nodePath}`,
		};
	}
	const major = Number(/^v(\d+)\./.exec(nodeVersion)?.[1]);
	if (!(major >= MIN_NODE_MAJOR)) {
		return {
			ok: false,
			code: 'UNSUPPORTED',
			message: `Nanocoder needs Node.js ${MIN_NODE_MAJOR} or newer; found ${nodeVersion}`,
		};
	}

	return {
		ok: true,
		runtime: {
			nodePath,
			nodeVersion,
			cliPath,
			version,
			source: cliOverride ? 'override' : 'path',
		},
	};
}
