import {execFile} from 'node:child_process';
import path from 'node:path';
import {IpcFailure} from '@/main/ipc/handle-request';

// The only Git subcommands the desktop can issue. Nothing here changes a
// repository, so GIT-14 is a property of this list, not of good intentions.
export const READ_ONLY_COMMANDS = new Set([
	'rev-parse',
	'status',
	'diff',
	'log',
]);

// Applied to every call (SEC-06, GIT-11): no pager, no file system monitor
// hook, no colour, and paths printed as they are.
const HARDENED = [
	'--no-pager',
	'-c',
	'core.fsmonitor=false',
	'-c',
	'core.pager=cat',
	'-c',
	'core.quotePath=false',
	'-c',
	'color.ui=false',
];

export interface GitRun {
	git: string;
	cwd: string;
	timeoutMs: number;
	maxBytes: number;
	// Text sent on standard input, for a diff against a file that exists only in memory.
	input?: string;
}

export interface GitOutput {
	stdout: Buffer;
	stderr: string;
	code: number;
}

export type GitRunner = (run: GitRun, args: string[]) => Promise<GitOutput>;

// No inherited GIT_* variable (such as GIT_EXTERNAL_DIFF or GIT_SSH_COMMAND)
// reaches Git. The user's own HOME is kept so their Git settings still apply.
export function gitEnvironment(
	git: string,
	inherited: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): Record<string, string> {
	const env: Record<string, string> = {
		PATH: path.dirname(git),
		LC_ALL: 'C',
		LANG: 'C',
		GIT_PAGER: 'cat',
		GIT_OPTIONAL_LOCKS: '0',
		GIT_TERMINAL_PROMPT: '0',
		GIT_ASKPASS: '',
		GIT_LITERAL_PATHSPECS: '1',
	};
	const keep =
		platform === 'win32'
			? [
					'SystemRoot',
					'USERPROFILE',
					'APPDATA',
					'LOCALAPPDATA',
					'HOMEDRIVE',
					'HOMEPATH',
				]
			: ['HOME', 'XDG_CONFIG_HOME', 'TMPDIR'];
	for (const name of keep) {
		const value = inherited[name];
		if (value !== undefined) env[name] = value;
	}
	return env;
}

export const runGit: GitRunner = (run, args) =>
	new Promise((resolve, reject) => {
		const [command] = args;
		if (!READ_ONLY_COMMANDS.has(command) && command !== '--version')
			return reject(
				new IpcFailure(
					'DENIED',
					'That Git command is not allowed in the desktop',
				),
			);
		if (
			command === 'diff' &&
			!(args.includes('--no-ext-diff') && args.includes('--no-textconv'))
		)
			return reject(
				new IpcFailure(
					'DENIED',
					'A diff must turn off external diff and text conversion',
				),
			);
		const prefix = command === '--version' ? [] : HARDENED;
		const child = execFile(
			run.git,
			[...prefix, ...args],
			{
				cwd: run.cwd,
				shell: false,
				timeout: run.timeoutMs,
				maxBuffer: run.maxBytes,
				encoding: 'buffer',
				windowsHide: true,
				env: gitEnvironment(run.git, process.env),
			},
			(error, stdout, stderr) => {
				const text = Buffer.from(stderr ?? '')
					.toString('utf8')
					.trim();
				if (!error) return resolve({stdout, stderr: text, code: 0});
				const failure = error as NodeJS.ErrnoException & {
					killed?: boolean;
					signal?: string;
				};
				if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
					return reject(
						new IpcFailure('LIMIT', 'The Git output was too large'),
					);
				if (failure.killed || failure.signal === 'SIGTERM')
					return reject(new IpcFailure('LIMIT', 'Git took too long to answer'));
				if (typeof failure.code === 'number')
					return resolve({stdout, stderr: text, code: failure.code});
				reject(new IpcFailure('UNAVAILABLE', 'Git could not be started'));
			},
		);
		if (run.input !== undefined) {
			child.stdin?.on('error', () => {});
			child.stdin?.end(run.input);
		}
	});
