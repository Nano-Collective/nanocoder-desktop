import * as React from 'react';
import Markdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {findLocalUrls} from '@/shared/local-url';

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

const components: Components = {
	a: MarkdownLink,
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

// Swappable while DEC-39 is proposed. Only localhost links act, and only through the opener; main still applies the origin policy.
export const AgentMarkdown = React.memo(function AgentMarkdown({
	text,
}: {
	text: string;
}) {
	return (
		<div className="stream-markdown">
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
		</div>
	);
});
