import type {Extension} from '@codemirror/state';

export type LanguageKey =
	| 'javascript'
	| 'typescript'
	| 'jsx'
	| 'tsx'
	| 'json'
	| 'markdown'
	| 'css'
	| 'html'
	| 'python'
	| 'yaml'
	| 'rust'
	| 'go'
	| 'cpp'
	| 'java'
	| 'sql'
	| 'xml';

const EXTENSIONS: Record<string, LanguageKey> = {
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'jsx',
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'tsx',
	json: 'json',
	jsonc: 'json',
	md: 'markdown',
	markdown: 'markdown',
	css: 'css',
	html: 'html',
	htm: 'html',
	py: 'python',
	yml: 'yaml',
	yaml: 'yaml',
	rs: 'rust',
	go: 'go',
	c: 'cpp',
	h: 'cpp',
	cc: 'cpp',
	cpp: 'cpp',
	hpp: 'cpp',
	java: 'java',
	sql: 'sql',
	xml: 'xml',
	svg: 'xml',
};

// A language is chosen by file extension only; the content is never sniffed.
export function languageKey(path: string): LanguageKey | null {
	const name = path.split('/').at(-1) ?? '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return null;
	return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null;
}

// Each language is its own chunk, loaded only when a file of that kind opens.
export async function loadLanguage(key: LanguageKey): Promise<Extension> {
	switch (key) {
		case 'javascript':
			return (await import('@codemirror/lang-javascript')).javascript();
		case 'jsx':
			return (await import('@codemirror/lang-javascript')).javascript({
				jsx: true,
			});
		case 'typescript':
			return (await import('@codemirror/lang-javascript')).javascript({
				typescript: true,
			});
		case 'tsx':
			return (await import('@codemirror/lang-javascript')).javascript({
				typescript: true,
				jsx: true,
			});
		case 'json':
			return (await import('@codemirror/lang-json')).json();
		case 'markdown':
			return (await import('@codemirror/lang-markdown')).markdown();
		case 'css':
			return (await import('@codemirror/lang-css')).css();
		case 'html':
			return (await import('@codemirror/lang-html')).html();
		case 'python':
			return (await import('@codemirror/lang-python')).python();
		case 'yaml':
			return (await import('@codemirror/lang-yaml')).yaml();
		case 'rust':
			return (await import('@codemirror/lang-rust')).rust();
		case 'go':
			return (await import('@codemirror/lang-go')).go();
		case 'cpp':
			return (await import('@codemirror/lang-cpp')).cpp();
		case 'java':
			return (await import('@codemirror/lang-java')).java();
		case 'sql':
			return (await import('@codemirror/lang-sql')).sql();
		case 'xml':
			return (await import('@codemirror/lang-xml')).xml();
	}
}
