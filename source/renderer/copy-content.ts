import {MAX_CLIPBOARD_LENGTH} from '@/shared/ipc';

export function fencedCodeText(
	source: string,
	prefix = '',
): string | undefined {
	const continuation = prefix.replace(/(?:[-+*]|\d+[.)])(?=\s)/g, value =>
		' '.repeat(value.length),
	);
	const lines = (source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []).map(
		(line, index) =>
			index > 0 && continuation && line.startsWith(continuation)
				? line.slice(continuation.length)
				: line,
	);
	const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*/.exec(lines[0] ?? '');
	if (!opening) return undefined;
	const fence = opening[1];
	const closing = new RegExp(
		`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r\\n|\\r|\\n)?$`,
	);
	let end = lines.length;
	for (let index = 1; index < lines.length; index++) {
		if (closing.test(lines[index])) {
			end = index;
			break;
		}
	}
	const indent = /^ */.exec(lines[0] ?? '')?.[0].length ?? 0;
	return lines
		.slice(1, end)
		.map(line => line.replace(new RegExp(`^ {0,${indent}}`), ''))
		.join('');
}

export async function copyContent(
	text: string,
	write: (text: string) => Promise<void>,
	notify: (message: string) => void,
): Promise<void> {
	if (text.length === 0) return;
	if (text.length > MAX_CLIPBOARD_LENGTH) {
		notify('copy failed. text exceeds the 1,000,000 character limit.');
		return;
	}
	try {
		await write(text);
		notify('copied');
	} catch {
		notify('copy failed. clipboard access was refused.');
	}
}
