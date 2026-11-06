import {findLocalUrls} from '@/shared/local-url';

export interface LinkCell {
	getChars(): string;
	getWidth(): number;
}

export interface LinkLine {
	length: number;
	isWrapped: boolean;
	getCell(x: number): LinkCell | undefined;
}

export interface TerminalLink {
	url: string;
	// One-based columns, inclusive, as xterm's link ranges use.
	startX: number;
	endX: number;
}

// Text and the column each character sits in, so wide characters cannot shift a link.
function lineText(line: LinkLine): {text: string; columns: number[]} {
	let text = '';
	const columns: number[] = [];
	for (let x = 0; x < line.length; x++) {
		const cell = line.getCell(x);
		if (!cell) break;
		if (cell.getWidth() === 0) continue;
		const chars = cell.getChars() || ' ';
		for (let index = 0; index < chars.length; index++) columns.push(x);
		text += chars;
	}
	return {text, columns};
}

export function terminalLinks(
	line: LinkLine | undefined,
	next: LinkLine | undefined,
): TerminalLink[] {
	if (!line) return [];
	const {text, columns} = lineText(line);
	const used = text.trimEnd().length;
	const links: TerminalLink[] = [];
	for (const match of findLocalUrls(text)) {
		const continued = next?.isWrapped === true && match.end >= used;
		const cutAbove = line.isWrapped && match.start === 0;
		if (continued || cutAbove) continue;
		links.push({
			url: match.url,
			startX: columns[match.start] + 1,
			endX: columns[match.end - 1] + 1,
		});
	}
	return links;
}
