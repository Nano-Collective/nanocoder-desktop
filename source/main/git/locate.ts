import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {access, stat} from 'node:fs/promises';
import path from 'node:path';
import type {GitRunner} from '@/main/git/run';
import {canonicalPath, isInside} from '@/main/paths';

export interface GitInstall {
	path: string;
	version: string;
}

export type GitLookup =
	| {ok: true; git: GitInstall}
	| {ok: false; reason: string};

export interface LocateOptions {
	// Every stored project root: a git program inside one is never used.
	roots(): readonly string[];
	run: GitRunner;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	// Resolves a candidate to a canonical executable path, or undefined.
	executable?(candidate: string): Promise<string | undefined>;
	// Whether Apple's developer tools are installed; /usr/bin/git is only a
	// prompt to install them until they are.
	developerTools?(): Promise<boolean>;
}

const MINIMUM = [2, 15];

// Without Apple's developer tools, /usr/bin/git is only a prompt to install them.
// `xcode-select -p` answers without showing that prompt.
function appleToolsInstalled(): Promise<boolean> {
	return new Promise(resolve => {
		execFile(
			'/usr/bin/xcode-select',
			['-p'],
			{shell: false, timeout: 3_000, windowsHide: true},
			error => resolve(!error),
		);
	});
}

async function usable(candidate: string): Promise<string | undefined> {
	try {
		const real = await canonicalPath(candidate);
		if (!(await stat(real)).isFile()) return undefined;
		await access(real, constants.X_OK);
		return real;
	} catch {
		return undefined;
	}
}

export function gitCandidates(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): string[] {
	const flavour = platform === 'win32' ? path.win32 : path.posix;
	const name = platform === 'win32' ? 'git.exe' : 'git';
	const known =
		platform === 'win32'
			? [
					env.ProgramFiles,
					env['ProgramFiles(x86)'],
					env.LOCALAPPDATA
						? path.win32.join(env.LOCALAPPDATA, 'Programs')
						: undefined,
				]
					.filter((value): value is string => !!value)
					.map(base => path.win32.join(base, 'Git', 'cmd', name))
			: [
					'/usr/bin/git',
					'/usr/local/bin/git',
					'/opt/homebrew/bin/git',
					'/snap/bin/git',
				];
	// PATH entries count only when absolute; the project filter runs later.
	const onPath = (env.PATH ?? env.Path ?? '')
		.split(platform === 'win32' ? ';' : ':')
		.filter(entry => entry && flavour.isAbsolute(entry))
		.map(entry => flavour.join(entry, name));
	return [...new Set([...known, ...onPath])];
}

export function parseVersion(text: string): string | undefined {
	return /git version (\d+(?:\.\d+)+)/u.exec(text)?.[1];
}

function tooOld(version: string): boolean {
	const parts = version.split('.').map(Number);
	for (let index = 0; index < MINIMUM.length; index++) {
		if ((parts[index] ?? 0) !== MINIMUM[index])
			return (parts[index] ?? 0) < MINIMUM[index];
	}
	return false;
}

export async function locateGit(options: LocateOptions): Promise<GitLookup> {
	const platform = options.platform ?? process.platform;
	const find = options.executable ?? usable;
	let stub = false;
	let old: string | undefined;
	for (const candidate of gitCandidates(platform, options.env ?? process.env)) {
		const program = await find(candidate);
		if (!program) continue;
		if (isInside(program, options.roots(), platform)) continue;
		if (
			platform === 'darwin' &&
			program === '/usr/bin/git' &&
			!(await (options.developerTools ?? appleToolsInstalled)())
		) {
			stub = true;
			continue;
		}
		const result = await options
			.run(
				{
					git: program,
					cwd: path.dirname(program),
					timeoutMs: 5_000,
					maxBytes: 4_096,
				},
				['--version'],
			)
			.catch(() => undefined);
		const version =
			result?.code === 0
				? parseVersion(result.stdout.toString('utf8'))
				: undefined;
		if (!version) continue;
		if (tooOld(version)) {
			old = version;
			continue;
		}
		return {ok: true, git: {path: program, version}};
	}
	if (old)
		return {
			ok: false,
			reason: `Git ${old} is too old; version 2.15 or newer is needed`,
		};
	if (stub)
		return {
			ok: false,
			reason:
				'The Git that comes with macOS needs the developer tools. Install them or Git from git-scm.com.',
		};
	return {ok: false, reason: 'Git is not installed, so review is unavailable'};
}
