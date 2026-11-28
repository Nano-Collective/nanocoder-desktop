import * as React from 'react';
import Markdown, {type Components, type ExtraProps} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {fencedCodeText} from '@/renderer/copy-content';
import {Icon} from '@/renderer/icons';
import {findLocalUrls} from '@/shared/local-url';

export const CopyContext = React.createContext<
	((text: string) => void) | undefined
>(undefined);
const MarkdownSource = React.createContext('');

export const LocalUrlContext = React.createContext<
	((url: string) => void) | undefined
>(undefined);

// Only a link that is entirely one localhost address survives; everything else stays text.
function localHref(href: string): string | null {
	const matches = findLocalUrls(href);
	return matches.length === 1 &&
		matches[0].start === 0 &&
		matches[0].end === href.length
		? matches[0].url
		: null;
}

function MarkdownLink({
	href,
	children,
}: {
	href?: string;
	children?: React.ReactNode;
}) {
	const open = React.useContext(LocalUrlContext);
	if (!open || !href)
		return <span className="stream-markdown-link">{children}</span>;
	return (
		<button
			type="button"
			className="stream-local-link"
			title={`open ${href} in the browser`}
			onClick={() => open(href)}
		>
			{children}
			<span className="stream-link-target"> ({new URL(href).host})</span>
		</button>
	);
}

function MarkdownPre({
	children,
	node,
}: React.ComponentProps<'pre'> & ExtraProps) {
	const copy = React.useContext(CopyContext);
	const source = React.useContext(MarkdownSource);
	const start = node?.position?.start.offset;
	const end = node?.position?.end.offset;
	const text =
		start === undefined || end === undefined
			? undefined
			: fencedCodeText(
					source.slice(start, end),
					source.slice(
						Math.max(
							source.lastIndexOf('\n', start - 1),
							source.lastIndexOf('\r', start - 1),
						) + 1,
						start,
					),
				);
	return (
		<div className="stream-code-block">
			{copy && text !== undefined && text.length > 0 && (
				<button
					type="button"
					className="stream-copy stream-code-copy"
					aria-label="copy code"
					title="copy code"
					onClick={() => copy(text)}
				>
					<Icon name="copy" size={14} />
					copy
				</button>
			)}
			<pre>{children}</pre>
		</div>
	);
}

const components: Components = {
	a: MarkdownLink,
	pre: MarkdownPre,
	img: ({alt}) => (
		<span className="stream-resource">
			[image not loaded: {alt || 'image'}]
		</span>
	),
	input: ({checked, type}) =>
		type === 'checkbox' ? (
			<input checked={checked} disabled type="checkbox" />
		) : null,
};

const listItemStart = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|\r?\n?$)/;
const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
const fenceClose = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/;

// Checks for constructs whose meaning spans blocks: CommonMark link reference
// definitions (including multiline or escaped-bracket labels), GFM footnotes
// and line-start HTML. Linear in input length.
function hasCrossBlockSyntax(text: string): boolean {
	if (/\[\^|^[ \t]{0,3}</m.test(text)) return true;
	const lines = text.split(/\r?\n/);
	let inLabel = false;
	for (const line of lines) {
		if (line.trim() === '') {
			inLabel = false;
			continue;
		}
		let start = 0;
		if (!inLabel) {
			const match = /^ {0,3}\[/.exec(line);
			if (!match) continue;
			inLabel = true;
			start = match[0].length;
		}
		for (let i = start; i < line.length; i++) {
			const ch = line[i];
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === '[') {
				inLabel = false;
				break;
			}
			if (ch === ']') {
				if (line[i + 1] === ':') return true;
				inLabel = false;
				break;
			}
		}
	}
	return false;
}

// Splits at a blank line only when the next line starts a new top-level block,
// so each part parses as it would inside the whole text. Text that can refer
// across blocks (link definitions, footnotes, HTML) stays in one block.
export function splitMarkdownBlocks(text: string): string[] {
	if (hasCrossBlockSyntax(text)) return [text];
	const blocks: string[] = [];
	let block = '';
	let content = false;
	let fence: string | null = null;
	let afterBlank = false;
	for (const line of text.split(/(?<=\n)/)) {
		const blank = line.trim() === '';
		if (
			afterBlank &&
			fence === null &&
			content &&
			!blank &&
			!/^\s/.test(line) &&
			!listItemStart.test(line)
		) {
			blocks.push(block);
			block = '';
			content = false;
		}
		block += line;
		content ||= !blank;
		if (fence === null) {
			const open = fenceOpen.exec(line);
			if (open) fence = open[1];
		} else {
			const close = fenceClose.exec(line);
			if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
				fence = null;
		}
		afterBlank = blank;
	}
	blocks.push(block);
	return blocks;
}

// Settled blocks skip parsing while a reply streams.
const MarkdownBlock = React.memo(function MarkdownBlock({
	text,
}: {
	text: string;
}) {
	return (
		<MarkdownSource.Provider value={text}>
			<Markdown
				skipHtml
				remarkPlugins={[remarkGfm]}
				unwrapDisallowed
				urlTransform={url => localHref(url) ?? ''}
				allowedElements={[
					'p',
					'h1',
					'h2',
					'h3',
					'h4',
					'h5',
					'h6',
					'blockquote',
					'ul',
					'ol',
					'li',
					'pre',
					'code',
					'strong',
					'em',
					'del',
					'hr',
					'br',
					'a',
					'img',
					'input',
					'table',
					'thead',
					'tbody',
					'tr',
					'th',
					'td',
				]}
				components={components}
			>
				{text}
			</Markdown>
		</MarkdownSource.Provider>
	);
});

// Swappable while DEC-39 is proposed. Only localhost links act, and only through the opener; main still applies the origin policy.
export const AgentMarkdown = React.memo(function AgentMarkdown({
	text,
}: {
	text: string;
}) {
	return (
		<div className="stream-markdown">
			{splitMarkdownBlocks(text).map((block, index) => (
				<MarkdownBlock key={index} text={block} />
			))}
		</div>
	);
});
