import {MAX_CLIPBOARD_LENGTH} from '@/shared/ipc';

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
const fenceClose = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r\n|\r|\n)?$/;

export function matchFenceOpen(line: string): string | null {
	return fenceOpen.exec(line)?.[1] ?? null;
}

export function isFenceClose(line: string, fence: string): boolean {
	const closing = fenceClose.exec(line);
	return (
		closing !== null &&
		closing[1][0] === fence[0] &&
		closing[1].length >= fence.length
	);
}

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
	const fence = matchFenceOpen(lines[0] ?? '');
	if (!fence) return undefined;
	let end = lines.length;
	for (let index = 1; index < lines.length; index++) {
		if (isFenceClose(lines[index], fence)) {
			end = index;
			break;
		}
	}
	const indent = /^ */.exec(lines[0] ?? '')?.[0].length ?? 0;
	return lines
		.slice(1, end)
		.map(line => {
			let remove = 0;
			while (remove < indent && line[remove] === ' ') remove++;
			return line.slice(remove);
		})
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
