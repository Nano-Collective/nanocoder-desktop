import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FindBar, type FindBarProps} from '@/renderer/find-bar';

const props: FindBarProps = {
	open: true,
	query: 'api',
	activeIndex: 1,
	total: 3,
	scopeLabel: 'open diff',
	hostLabel: 'find in unstaged changes in api.ts',
	inputRef: {current: null},
	onQueryChange() {},
	onNext() {},
	onPrevious() {},
	onClose() {},
};

function render(change: Partial<FindBarProps> = {}): string {
	return renderToStaticMarkup(createElement(FindBar, {...props, ...change}));
}

test('a closed find bar renders nothing', t => {
	t.is(render({open: false}), '');
});

test('an open find bar names its input, scope and position', t => {
	const html = render();
	t.regex(html, /type="search"/);
	t.regex(html, /value="api"/);
	t.regex(html, /aria-label="find in unstaged changes in api\.ts"/);
	t.regex(html, /placeholder="find in open diff…"/);
	t.regex(html, /autocomplete="off"/i);
	t.regex(html, /role="status"/);
	t.regex(html, /aria-live="polite"/);
	t.true(html.includes('2 of 3 · open diff'));
	t.false(html.includes('disabled'));
});

test('previous and next are disabled without results, and close stays enabled', t => {
	const html = render({query: 'zz', activeIndex: -1, total: 0});
	t.true(html.includes('no matches in open diff'));
	t.is(html.match(/disabled=""/g)?.length, 2);
	t.regex(html, /aria-label="close find"/);
});

test('a host label is escaped, so a file name cannot break the markup', t => {
	const html = render({hostLabel: "find in Bob's <notes> & co.md"});
	t.true(
		html.includes('aria-label="find in Bob&#x27;s &lt;notes&gt; &amp; co.md"'),
	);
	t.false(html.includes('<notes>'));
});
