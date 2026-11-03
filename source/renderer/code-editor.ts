import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {EditorView, lineNumbers} from '@codemirror/view';
import {tags} from '@lezer/highlight';
import {languageKey, loadLanguage} from '@/renderer/code-languages';

// Colours come from the design tokens, so both themes work without a second
// stylesheet (DESIGN.md owns the palette; nothing is chosen here).
const highlight = HighlightStyle.define([
	{
		tag: [tags.keyword, tags.modifier, tags.controlKeyword],
		color: 'var(--colors-primary)',
	},
	{
		tag: [tags.string, tags.regexp, tags.special(tags.string)],
		color: 'var(--colors-success)',
	},
	{
		tag: [tags.number, tags.bool, tags.null, tags.atom],
		color: 'var(--colors-warning)',
	},
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment],
		color: 'var(--colors-on-surface-muted)',
	},
	{
		tag: [
			tags.typeName,
			tags.className,
			tags.definition(tags.variableName),
			tags.function(tags.variableName),
		],
		color: 'var(--colors-heading)',
	},
	{tag: [tags.heading], color: 'var(--colors-heading)', fontWeight: '600'},
	{tag: [tags.link, tags.url], color: 'var(--colors-mention)'},
	{tag: [tags.invalid], color: 'var(--colors-error)'},
]);

const theme = EditorView.theme({
	'&': {
		color: 'var(--colors-on-surface)',
		backgroundColor: 'transparent',
		fontSize: '12px',
		height: '100%',
	},
	'.cm-scroller': {
		fontFamily: 'var(--typography-code-font-family, inherit)',
		lineHeight: '1.6',
		overflow: 'auto',
	},
	'.cm-content': {caretColor: 'transparent', padding: '6px 0'},
	'.cm-gutters': {
		backgroundColor: 'transparent',
		color: 'var(--colors-on-surface-muted)',
		border: 'none',
	},
	'&.cm-focused': {
		outline: '2px solid var(--colors-primary)',
		outlineOffset: '-2px',
	},
	'.cm-activeLine, .cm-activeLineGutter': {backgroundColor: 'transparent'},
});

export interface CodeViewHandle {
	destroy(): void;
}

// A read-only view (FILE-09: the desktop browses, it does not edit). It lives in
// a shadow root so CodeMirror's stylesheet is adopted rather than injected as a
// <style> element, which the app's Content Security Policy forbids.
export async function mountCodeView(
	host: HTMLElement,
	options: {text: string; path: string; highlight: boolean; label: string},
): Promise<CodeViewHandle> {
	const shadow = host.shadowRoot ?? host.attachShadow({mode: 'open'});
	shadow.replaceChildren();
	const parent = document.createElement('div');
	parent.style.height = '100%';
	shadow.append(parent);
	const key = options.highlight ? languageKey(options.path) : null;
	const language = key ? await loadLanguage(key).catch(() => null) : null;
	const view = new EditorView({
		parent,
		root: shadow,
		state: EditorState.create({
			doc: options.text,
			extensions: [
				lineNumbers(),
				theme,
				EditorState.readOnly.of(true),
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({
					tabindex: '0',
					'aria-readonly': 'true',
					'aria-label': options.label,
					role: 'textbox',
					'aria-multiline': 'true',
				}),
				...(language ? [language, syntaxHighlighting(highlight)] : []),
			],
		}),
	});
	return {destroy: () => view.destroy()};
}
