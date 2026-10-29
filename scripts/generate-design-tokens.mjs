import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parse} from 'yaml';

export const designUrl = new URL('../DESIGN.md', import.meta.url);
export const cssUrl = new URL(
	'../source/renderer/styles/tokens.css',
	import.meta.url,
);

const kebab = value => value.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const tokenGroups = [
	'colors',
	'typography',
	'rounded',
	'spacing',
	'components',
];

export function parseDesign(markdown) {
	const frontMatter = /^---\r?\n([\s\S]+?)\r?\n---/.exec(markdown);
	if (!frontMatter) throw new Error('DESIGN.md needs YAML front matter');
	const tokens = parse(frontMatter[1]);
	for (const group of tokenGroups) {
		if (!tokens[group]) throw new Error(`Missing token group: ${group}`);
	}
	for (const name of Object.keys(tokens.colors)) {
		if (!name.endsWith('-light') && !tokens.colors[`${name}-light`]) {
			throw new Error(`Missing light colour: ${name}`);
		}
	}
	return tokens;
}

export function generateTokens(tokens) {
	const declarations = [];
	function flatten(value, parts) {
		if (typeof value === 'object') {
			for (const [name, child] of Object.entries(value)) {
				flatten(child, [...parts, kebab(name)]);
			}
			return;
		}
		const reference = /^\{([^}]+)\}$/.exec(String(value));
		if (reference) {
			const path = reference[1].split('.');
			const target = path.reduce((current, key) => current?.[key], tokens);
			if (target === undefined) throw new Error(`Unknown token: ${value}`);
			if (typeof target === 'object') {
				const base = parts.at(-1) === 'typography' ? parts.slice(0, -1) : parts;
				for (const key of Object.keys(target)) {
					flatten(`{${reference[1]}.${key}}`, [...base, kebab(key)]);
				}
				return;
			}
			value = `var(--${path.map(kebab).join('-')})`;
		} else if (parts.at(-1) === 'font-family') {
			value = `"${value}", Consolas, Menlo, monospace`;
		}
		declarations.push(`\t--${parts.join('-')}: ${value};`);
	}
	for (const group of tokenGroups) {
		flatten(tokens[group], [group]);
	}
	const light = Object.entries(tokens.colors)
		.filter(([name]) => name.endsWith('-light'))
		.map(([name, value]) => `\t--colors-${name.slice(0, -6)}: ${value};`);
	const css = [
		'/* Generated from DESIGN.md by pnpm tokens:generate. Do not edit. */',
		':root {',
		...declarations,
		'}',
		'',
		':root[data-theme="light"] {',
		...light,
		'}',
		'',
	].join('\n');
	return execFileSync(
		process.execPath,
		[
			fileURLToPath(
				new URL('../node_modules/@biomejs/biome/bin/biome', import.meta.url),
			),
			'format',
			'--stdin-file-path',
			fileURLToPath(cssUrl),
		],
		{input: css, encoding: 'utf8'},
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const css = generateTokens(parseDesign(await readFile(designUrl, 'utf8')));
	await writeFile(cssUrl, css);
	console.info(`Generated ${fileURLToPath(cssUrl)}`);
}
