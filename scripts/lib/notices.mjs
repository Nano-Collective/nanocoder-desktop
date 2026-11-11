import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';

const MAX_LICENCE_BYTES = 200 * 1024;
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicen[cs]e)(\.|-|$)/i;
const RULE = '-'.repeat(59);

const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ISC_TERMS = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`;

const clean = text =>
	text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map(line => line.trimEnd())
		.join('\n')
		.trim();

// The package a bundled module belongs to, for pnpm and plain node_modules layouts.
export function packageDirFromModuleId(id) {
	if (id.startsWith('\0')) return undefined;
	const normal = id.split('?')[0].replaceAll('\\', '/');
	const marker = '/node_modules/';
	const at = normal.lastIndexOf(marker);
	if (at < 0) return undefined;
	const rest = normal.slice(at + marker.length).split('/');
	const name = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
	if (!name || name === '.pnpm') return undefined;
	return {name, dir: `${normal.slice(0, at)}${marker}${name}`};
}

function licenceOf(json) {
	if (typeof json.license === 'string') return json.license;
	if (json.license && typeof json.license.type === 'string')
		return json.license.type;
	if (
		Array.isArray(json.licenses) &&
		typeof json.licenses[0]?.type === 'string'
	)
		return json.licenses[0].type;
	return undefined;
}

function sourceOf(json) {
	let value =
		typeof json.repository === 'string'
			? json.repository
			: json.repository?.url;
	if (typeof value !== 'string') return undefined;
	value = value
		.trim()
		.replace(/^git\+/, '')
		.replace(/#.*$/, '')
		.replace(/\.git$/, '');
	const shortcut = /^(github:)?([\w.-]+)\/([\w.-]+)$/.exec(value);
	if (shortcut) return `https://github.com/${shortcut[2]}/${shortcut[3]}`;
	return value
		.replace(/^git:\/\//, 'https://')
		.replace(/^ssh:\/\/git@/, 'https://')
		.replace(/^git@github\.com:/, 'https://github.com/')
		.replace(/^http:\/\//, 'https://');
}

export function readPackage(dir) {
	const json = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
	const files = readdirSync(dir)
		.filter(name => LICENCE_FILE.test(name))
		.filter(name => {
			const stats = statSync(path.join(dir, name));
			return (
				stats.isFile() && stats.size > 0 && stats.size <= MAX_LICENCE_BYTES
			);
		})
		.sort()
		.map(name => ({
			name,
			text: clean(readFileSync(path.join(dir, name), 'utf8')),
		}));
	return {
		name: json.name,
		version: json.version,
		license: licenceOf(json),
		source: sourceOf(json),
		files,
	};
}

// Every installed package under a node_modules folder, nested ones included, once per name and version.
export function collectTree(nodeModules) {
	const found = new Map();
	const visit = folder => {
		if (!existsSync(folder)) return;
		for (const entry of readdirSync(folder)) {
			if (entry.startsWith('.')) continue;
			const entryPath = path.join(folder, entry);
			if (entry.startsWith('@')) {
				visit(entryPath);
				continue;
			}
			if (!existsSync(path.join(entryPath, 'package.json'))) continue;
			const item = readPackage(entryPath);
			const key = `${item.name}@${item.version}`;
			if (!found.has(key)) found.set(key, item);
			visit(path.join(entryPath, 'node_modules'));
		}
	};
	visit(nodeModules);
	return [...found.values()].sort(compare);
}

const compare = (a, b) =>
	a.name === b.name
		? a.version.localeCompare(b.version)
		: a.name.localeCompare(b.name);

// Allowed when any OR alternative, or every AND part, is on the list. Anything it cannot read is not allowed.
export function spdxAllowed(expression, allowed) {
	if (typeof expression !== 'string' || expression.trim() === '') return false;
	const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
	let at = 0;
	const parseOr = () => {
		let result = parseAnd();
		while (tokens[at] === 'OR') {
			at++;
			const next = parseAnd();
			result = result || next;
		}
		return result;
	};
	const parseAnd = () => {
		let result = parseAtom();
		while (tokens[at] === 'AND') {
			at++;
			const next = parseAtom();
			result = result && next;
		}
		return result;
	};
	const parseAtom = () => {
		const token = tokens[at++];
		if (token === '(') {
			const inner = parseOr();
			if (tokens[at++] !== ')') throw new Error('unbalanced');
			return inner;
		}
		if (
			token === undefined ||
			token === ')' ||
			token === 'OR' ||
			token === 'AND'
		)
			throw new Error('unexpected');
		return allowed.includes(token.replace(/\+$/, ''));
	};
	try {
		const value = parseOr();
		return at === tokens.length && value;
	} catch {
		return false;
	}
}

export function licenceProblems(packages, policy, options = {}) {
	const problems = [];
	const used = new Set();
	const seen = new Set();
	for (const item of packages) {
		const key = `${item.name}@${item.version}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (policy.exceptions?.[key]) {
			used.add(key);
			continue;
		}
		if (!item.license) problems.push(`${key} declares no licence`);
		else if (!spdxAllowed(item.license, policy.allowed))
			problems.push(`${key} has a licence outside the policy: ${item.license}`);
	}
	if (options.reportUnusedExceptions !== false)
		for (const key of Object.keys(policy.exceptions ?? {}))
			if (!used.has(key))
				problems.push(`The exception for ${key} is no longer needed`);
	return problems;
}

const isApacheText = text =>
	/Apache License/i.test(text) && /Version 2\.0/.test(text);

// Which standard terms stand in for a package that ships no licence file.
function appendixFor(license) {
	const ids = (license ?? '').match(/[A-Za-z0-9.+-]+/g) ?? [];
	return ['MIT', 'ISC', 'Apache-2.0'].find(id => ids.includes(id));
}

export function renderNotices({title, intro, sections}) {
	const out = [`${title}\n\n${intro}\n`];
	const needed = new Set();
	const all = [];
	for (const {heading, packages} of sections) {
		out.push(`\n${heading}\n${'-'.repeat(heading.length)}\n`);
		const seen = new Set();
		for (const item of [...packages].sort(compare)) {
			const key = `${item.name}@${item.version}`;
			if (seen.has(key)) continue;
			seen.add(key);
			all.push(item);
			const lines = [
				`\n${item.name} ${item.version}`,
				`Licence: ${item.license}`,
			];
			if (item.source) lines.push(`Source: ${item.source}`);
			if (item.files.length > 0) {
				out.push(
					`${lines.join('\n')}\n\n${item.files.map(file => file.text).join('\n\n')}\n\n${RULE}\n`,
				);
			} else {
				const id = appendixFor(item.license);
				if (!id)
					throw new Error(
						`${key} ships no licence file and has no standard terms to point to (${item.license})`,
					);
				needed.add(id);
				out.push(
					`${lines.join('\n')}\n\nThis package ships no licence file; its package.json declares ${item.license}. The ${id} terms are at the end of this file.\n\n${RULE}\n`,
				);
			}
		}
	}
	for (const id of ['MIT', 'ISC', 'Apache-2.0']) {
		if (!needed.has(id)) continue;
		const terms =
			id === 'MIT'
				? MIT_TERMS
				: id === 'ISC'
					? ISC_TERMS
					: all
							.flatMap(item => item.files)
							.find(file => isApacheText(file.text))?.text;
		if (!terms) throw new Error(`No ${id} text is available for the appendix`);
		out.push(
			`\n${id} licence (for packages that ship no licence file)\n${'-'.repeat(`${id} licence (for packages that ship no licence file)`.length)}\n\n${terms}\n`,
		);
	}
	return `${out.join('')}`.replace(/\n+$/, '\n');
}

// What a built app must carry (REL-06): the desktop's notices, Electron's and Chromium's, Node's licence, and
// runtime notices that list every package in the shipped tree and hold Nanocoder's own licence.
export function verifyShippedNotices(resources) {
	const problems = [];
	const filled = file => existsSync(file) && statSync(file).size > 0;
	if (!filled(path.join(resources, 'THIRD-PARTY-NOTICES.txt')))
		problems.push('THIRD-PARTY-NOTICES.txt is missing or empty');
	// Electron keeps this beside the app on Windows and Linux, and in Resources on macOS.
	if (
		!existsSync(path.join(resources, 'LICENSES.chromium.html')) &&
		!existsSync(path.join(resources, '..', 'LICENSES.chromium.html'))
	)
		problems.push('LICENSES.chromium.html is missing');
	if (!filled(path.join(resources, 'runtime', 'node', 'LICENSE')))
		problems.push('runtime/node/LICENSE is missing or empty');
	const noticesFile = path.join(
		resources,
		'runtime',
		'THIRD-PARTY-NOTICES.txt',
	);
	if (!filled(noticesFile)) {
		problems.push('runtime/THIRD-PARTY-NOTICES.txt is missing or empty');
		return problems;
	}
	const notices = clean(readFileSync(noticesFile, 'utf8'));
	const tree = collectTree(
		path.join(resources, 'runtime', 'nanocoder', 'node_modules'),
	);
	for (const item of tree)
		if (!`\n${notices}\n`.includes(`\n${item.name} ${item.version}\n`))
			problems.push(
				`runtime/THIRD-PARTY-NOTICES.txt does not list ${item.name}@${item.version}`,
			);
	const nanocoder = tree.find(
		item => item.name === '@nanocollective/nanocoder',
	);
	const own = nanocoder?.files[0]?.text;
	if (!own || !notices.includes(own))
		problems.push(
			"runtime/THIRD-PARTY-NOTICES.txt does not contain Nanocoder's own licence text",
		);
	return problems;
}
