const URL_LIMIT = 2_048;
const TAIL = 16_384;
const HOST = String.raw`(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])`;
const AFTER = String.raw`(?=[/?#]|\s|$|[)\]}>"'\x60,;:!?]|\.(?:\s|$))`;
const PATH = String.raw`(?:[/?#][^\s<>"'\x60]*)?`;
const WITH_SCHEME = new RegExp(
	String.raw`(?<![\w./=@%+-])https?://${HOST}(?::\d{1,5})?${AFTER}${PATH}`,
	'giu',
);
const BARE = new RegExp(
	String.raw`(?<![\w./=@%+:-])${HOST}:\d{1,5}${AFTER}${PATH}`,
	'giu',
);

export interface LocalUrlMatch {
	url: string;
	start: number;
	end: number;
}

export function stripAnsi(text: string): string {
	return text
		.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
		.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
		.replace(/\u001b[@-Z\\-_]/g, '');
}

function trimmed(match: string): string {
	let text = match;
	for (;;) {
		const last = text.at(-1) ?? '';
		if ('.,;:!?'.includes(last)) text = text.slice(0, -1);
		else if (
			(last === ')' && count(text, '(') < count(text, ')')) ||
			(last === ']' && count(text, '[') < count(text, ']')) ||
			(last === '}' && count(text, '{') < count(text, '}'))
		)
			text = text.slice(0, -1);
		else return text;
	}
}

const count = (text: string, character: string): number =>
	text.split(character).length - 1;

function loopback(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return (
			host === 'localhost' ||
			host === '[::1]' ||
			/^127(\.\d{1,3}){3}$/.test(host)
		);
	} catch {
		return false;
	}
}

export function findLocalUrls(text: string): LocalUrlMatch[] {
	const found: LocalUrlMatch[] = [];
	for (const pattern of [WITH_SCHEME, BARE]) {
		for (const match of text.matchAll(pattern)) {
			const raw = trimmed(match[0]);
			const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
			if (url.length > URL_LIMIT || !loopback(url)) continue;
			found.push({
				url,
				start: match.index,
				end: match.index + raw.length,
			});
		}
	}
	return found.sort((a, b) => a.start - b.start);
}

export function latestLocalUrl(output: string): string | null {
	const matches = findLocalUrls(stripAnsi(output.slice(-TAIL)));
	return matches.at(-1)?.url ?? null;
}
