import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access, stat} from 'node:fs/promises';
import path from 'node:path';
import {IpcFailure} from '@/main/ipc/handle-request';
import {canonicalPath, isInside} from '@/main/paths';
import type {DesktopSettings} from '@/shared/ipc';

type EditorId = DesktopSettings['editor'];
type Named = Exclude<EditorId, 'system'>;

const LABELS: Record<Named, string> = {
	code: 'Visual Studio Code',
	cursor: 'Cursor',
	zed: 'Zed',
};

// Known install locations only. A name is never looked up on PATH, so a
// project cannot put its own program in the way (SEC-05).
export function editorCandidates(
	editor: Named,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	home: string,
): string[] {
	if (platform === 'win32') {
		const local = env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local');
		const programs = path.win32.join(local, 'Programs');
		return {
			code: [path.win32.join(programs, 'Microsoft VS Code', 'Code.exe')],
			cursor: [path.win32.join(programs, 'cursor', 'Cursor.exe')],
			zed: [path.win32.join(programs, 'Zed', 'zed.exe')],
		}[editor];
	}
	if (platform === 'darwin') {
		return {
			code: [
				'/usr/local/bin/code',
				'/opt/homebrew/bin/code',
				'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
			],
			cursor: [
				'/usr/local/bin/cursor',
				'/opt/homebrew/bin/cursor',
				'/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
			],
			zed: [
				'/usr/local/bin/zed',
				'/opt/homebrew/bin/zed',
				'/Applications/Zed.app/Contents/MacOS/cli',
			],
		}[editor];
	}
	return {
		code: ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'],
		cursor: ['/usr/bin/cursor', '/usr/local/bin/cursor'],
		zed: [
			'/usr/bin/zed',
			'/usr/local/bin/zed',
			path.posix.join(home, '.local/bin/zed'),
		],
	}[editor];
}

export function editorArguments(
	editor: Named,
	file: string,
	line: number | undefined,
): string[] {
	if (line === undefined) return [file];
	return editor === 'zed' ? [`${file}:${line}`] : ['--goto', `${file}:${line}`];
}

// The operating system's default handler runs these instead of opening them
// for editing, so the system editor refuses them (SEC-05).
const PROGRAM_EXTENSIONS: Record<'darwin' | 'win32' | 'other', Set<string>> = {
	darwin: new Set([
		'.app',
		'.action',
		'.applescript',
		'.command',
		'.dmg',
		'.fileloc',
		'.inetloc',
		'.jar',
		'.mpkg',
		'.pkg',
		'.prefpane',
		'.scpt',
		'.scptd',
		'.shortcut',
		'.terminal',
		'.tool',
		'.webloc',
		'.workflow',
	]),
	win32: new Set([
		'.appref-ms',
		'.application',
		'.bat',
		'.chm',
		'.cmd',
		'.com',
		'.cpl',
		'.exe',
		'.gadget',
		'.hta',
		'.inf',
		'.jar',
		'.js',
		'.jse',
		'.lnk',
		'.msc',
		'.msi',
		'.msp',
		'.pif',
		'.ps1',
		'.psm1',
		'.reg',
		'.scf',
		'.scr',
		'.settingcontent-ms',
		'.url',
		'.vb',
		'.vbe',
		'.vbs',
		'.website',
		'.ws',
		'.wsc',
		'.wsf',
		'.wsh',
	]),
	other: new Set(['.appimage', '.desktop', '.jar', '.run']),
};

export function runsAsProgram(
	file: string,
	platform: NodeJS.Platform,
	mode: number,
): boolean {
	const flavour = platform === 'win32' ? path.win32 : path.posix;
	const extension = flavour.extname(file).toLowerCase();
	const key =
		platform === 'darwin' || platform === 'win32' ? platform : 'other';
	if (PROGRAM_EXTENSIONS[key].has(extension)) return true;
	return platform !== 'win32' && (mode & 0o111) !== 0;
}

function fileManagerName(platform: NodeJS.Platform): string {
	if (platform === 'darwin') return 'Finder';
	if (platform === 'win32') return 'File Explorer';
	return 'the file manager';
}

async function fileMode(file: string): Promise<number | undefined> {
	try {
		return (await stat(file)).mode;
	} catch {
		return undefined;
	}
}

export interface EditorOptions {
	editor(): EditorId;
	// Roots of every stored project: a program inside one is never launched.
	roots(): readonly string[];
	openPath(file: string): Promise<string>;
	showItemInFolder(file: string): void;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	home?: string;
	// The file's mode bits, or undefined when they cannot be read.
	mode?(file: string): Promise<number | undefined>;
	// Resolves a candidate to a canonical executable path, or undefined.
	executable?(candidate: string): Promise<string | undefined>;
	launch?(file: string, args: string[]): Promise<void>;
}

async function usableExecutable(
	candidate: string,
): Promise<string | undefined> {
	try {
		const real = await canonicalPath(candidate);
		if (!(await stat(real)).isFile()) return undefined;
		await access(real, constants.X_OK);
		return real;
	} catch {
		return undefined;
	}
}

function launchDetached(file: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, {
			shell: false,
			detached: true,
			stdio: 'ignore',
			windowsHide: true,
		});
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

export class EditorLauncher {
	constructor(private readonly options: EditorOptions) {}

	// The caller has already resolved and contained the path (SEC-03).
	async open(file: string, line?: number): Promise<{editor: EditorId}> {
		const editor = this.options.editor();
		const platform = this.options.platform ?? process.platform;
		if (editor === 'system') {
			const mode = await (this.options.mode ?? fileMode)(file);
			if (mode === undefined)
				throw new IpcFailure(
					'UNAVAILABLE',
					'The system could not open that file',
				);
			if (runsAsProgram(file, platform, mode))
				throw new IpcFailure(
					'UNAVAILABLE',
					`This file could run as a program, so it is not opened with the system default. Reveal it in ${fileManagerName(platform)}, or choose an editor in settings.`,
				);
			const failure = await this.options.openPath(file);
			if (failure)
				throw new IpcFailure(
					'UNAVAILABLE',
					'The system could not open that file',
				);
			return {editor};
		}
		const candidates = editorCandidates(
			editor,
			platform,
			this.options.env ?? process.env,
			this.options.home ?? '',
		);
		const find = this.options.executable ?? usableExecutable;
		for (const candidate of candidates) {
			const program = await find(candidate);
			if (!program) continue;
			if (isInside(program, this.options.roots(), platform)) continue;
			try {
				await (this.options.launch ?? launchDetached)(
					program,
					editorArguments(editor, file, line),
				);
				return {editor};
			} catch {
				throw new IpcFailure(
					'UNAVAILABLE',
					`${LABELS[editor]} could not be started`,
				);
			}
		}
		throw new IpcFailure(
			'UNAVAILABLE',
			`${LABELS[editor]} was not found. Choose another editor in settings.`,
		);
	}

	reveal(file: string): void {
		this.options.showItemInFolder(file);
	}
}
