import test from 'ava';
import {
	type LanguageKey,
	languageKey,
	loadLanguage,
} from '@/renderer/code-languages';

test('FILE-04 a language is chosen from the file extension alone', t => {
	for (const [path, key] of [
		['src/app.ts', 'typescript'],
		['src/app.TSX', 'tsx'],
		['a.mjs', 'javascript'],
		['a.jsx', 'jsx'],
		['package.json', 'json'],
		['README.md', 'markdown'],
		['styles/site.css', 'css'],
		['index.html', 'html'],
		['tool.py', 'python'],
		['ci.yml', 'yaml'],
		['lib.rs', 'rust'],
		['main.go', 'go'],
		['util.h', 'cpp'],
		['Main.java', 'java'],
		['query.sql', 'sql'],
		['logo.svg', 'xml'],
	] as const)
		t.is(languageKey(path), key, path);
});

test('FILE-04 names with no usable extension have no language and are never sniffed', t => {
	for (const path of [
		'Makefile',
		'.env',
		'.gitignore',
		'archive.unknown',
		'dir.ts/readme',
		'noext.',
		'',
	])
		t.is(languageKey(path), null, path);
});

test('FILE-04 every language key loads its own CodeMirror language', async t => {
	const keys: LanguageKey[] = [
		'javascript',
		'typescript',
		'jsx',
		'tsx',
		'json',
		'markdown',
		'css',
		'html',
		'python',
		'yaml',
		'rust',
		'go',
		'cpp',
		'java',
		'sql',
		'xml',
	];
	for (const key of keys) t.truthy(await loadLanguage(key), key);
});
