import * as React from 'react';
import Markdown, {type Components} from 'react-markdown';

const components: Components = {
	a: ({children}) => <span className="stream-markdown-link">{children}</span>,
	img: ({alt}) => (
		<span className="stream-resource">
			[image not loaded: {alt || 'image'}]
		</span>
	),
};

// Swappable while DEC-39 is proposed; links stay inert until main owns navigation.
export const AgentMarkdown = React.memo(function AgentMarkdown({
	text,
}: {
	text: string;
}) {
	return (
		<div className="stream-markdown">
			<Markdown
				skipHtml
				urlTransform={() => ''}
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
					'hr',
					'br',
					'a',
					'img',
				]}
				components={components}
			>
				{text}
			</Markdown>
		</div>
	);
});
