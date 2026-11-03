import {constants} from 'node:fs';
import {access, stat} from 'node:fs/promises';
import {userInfo} from 'node:os';
import path from 'node:path';
import {IpcFailure} from '@/main/ipc/handle-request';
import {canonicalPath, isInside} from '@/main/paths';

export interface Shell {
	file: string;
	args: string[];
}

export async function discoverShell(options: {
	roots: readonly string[];
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	accountShell?: string;
	validate?: (file: string) => Promise<string>;
}): Promise<Shell> {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const flavour = platform === 'win32' ? path.win32 : path.posix;
	let account = options.accountShell;
	if (account === undefined && platform !== 'win32') {
		try {
			account = userInfo().shell ?? undefined;
		} catch {}
	}
	const windows = env.SystemRoot ?? 'C:\\Windows';
	const candidates =
		platform === 'win32'
			? [
					env.ComSpec,
					env.COMSPEC,
					'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
					flavour.join(
						windows,
						'System32',
						'WindowsPowerShell',
						'v1.0',
						'powershell.exe',
					),
					flavour.join(windows, 'System32', 'cmd.exe'),
				]
			: [
					account,
					env.SHELL,
					...(platform === 'darwin' ? ['/bin/zsh'] : []),
					'/bin/bash',
					'/bin/sh',
				];
	const validate =
		options.validate ??
		(async file => {
			const canonical = await canonicalPath(file);
			if (!(await stat(canonical)).isFile()) throw new Error();
			await access(canonical, constants.X_OK);
			return canonical;
		});
	for (const candidate of candidates) {
		if (!candidate || !flavour.isAbsolute(candidate)) continue;
		try {
			const file = await validate(candidate);
			if (
				!flavour.isAbsolute(file) ||
				isInside(candidate, options.roots, platform) ||
				isInside(file, options.roots, platform)
			)
				continue;
			const name = flavour.basename(file).toLowerCase();
			if (platform === 'win32') {
				if (!['pwsh.exe', 'powershell.exe', 'cmd.exe'].includes(name)) continue;
				return {
					file,
					args: name === 'cmd.exe' ? ['/D', '/Q'] : ['-NoLogo', '-NoExit'],
				};
			}
			return {
				file,
				args: ['zsh', 'bash', 'sh', 'fish'].includes(name) ? ['-l'] : [],
			};
		} catch {}
	}
	throw new IpcFailure(
		'UNAVAILABLE',
		'No available shell outside the project folders',
	);
}

export function terminalEnvironment(
	env: NodeJS.ProcessEnv,
): Record<string, string> {
	const clean: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (
			value !== undefined &&
			!/^(NODE_OPTIONS|NODE_PATH|ELECTRON_.*|NANOCODER_TRUST_DIRECTORY|ENV|BASH_ENV|ZDOTDIR|LD_.*|DYLD_.*)$/i.test(
				key,
			)
		)
			clean[key] = value;
	}
	clean.TERM = 'xterm-256color';
	return clean;
}
