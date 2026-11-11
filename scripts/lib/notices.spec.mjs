import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	collectTree,
	licenceProblems,
	packageDirFromModuleId,
	readPackage,
	renderNotices,
	spdxAllowed,
	verifyShippedNotices,
} from './notices.mjs';

const temps = [];
test.after.always(() => {
	for (const dir of temps) rmSync(dir, {recursive: true, force: true});
});
const tempDir = () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'nd-notices-'));
	temps.push(dir);
	return dir;
};

function pkg(root, name, version, fields = {}, files = {}) {
	const dir = path.join(root, 'node_modules', ...name.split('/'));
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify({name, version, ...fields}),
	);
	for (const [file, text] of Object.entries(files))
		writeFileSync(path.join(dir, file), text);
	return dir;
}

test('REL-06 a module id maps to its package, for pnpm and plain layouts, scoped names, queries and Windows paths', t => {
	t.deepEqual(
		packageDirFromModuleId(
			'/r/node_modules/.pnpm/react@19.3.1/node_modules/react/index.js',
		),
		{
			name: 'react',
			dir: '/r/node_modules/.pnpm/react@19.3.1/node_modules/react',
		},
	);
	t.deepEqual(
		packageDirFromModuleId('/r/node_modules/@lezer/common/dist/index.js?x=1'),
		{name: '@lezer/common', dir: '/r/node_modules/@lezer/common'},
	);
	t.deepEqual(
		packageDirFromModuleId(
			'C:\\r\\node_modules\\.pnpm\\zod@4.6.7\\node_modules\\zod\\index.js',
		),
		{
			name: 'zod',
			dir: 'C:/r/node_modules/.pnpm/zod@4.6.7/node_modules/zod',
		},
	);
	t.is(packageDirFromModuleId('/r/source/main/index.ts'), undefined);
	t.is(packageDirFromModuleId('\0virtual:thing'), undefined);
});

test('REL-06 a package is read with its licence, source and licence files, with line endings normalised', t => {
	const root = tempDir();
	const dir = pkg(
		root,
		'@s/a',
		'1.2.3',
		{license: 'MIT', repository: {url: 'git+https://github.com/s/a.git'}},
		{LICENSE: 'Copyright (c) S\r\nMIT text  \r\n', 'NOTICE.md': 'A notice'},
	);
	t.deepEqual(readPackage(dir), {
		name: '@s/a',
		version: '1.2.3',
		license: 'MIT',
		source: 'https://github.com/s/a',
		files: [
			{name: 'LICENSE', text: 'Copyright (c) S\nMIT text'},
			{name: 'NOTICE.md', text: 'A notice'},
		],
	});
});

test('REL-06 older licence fields and git shortcuts are read as a licence and an address', t => {
	const root = tempDir();
	t.like(readPackage(pkg(root, 'old', '1.0.0', {license: {type: 'MIT'}})), {
		license: 'MIT',
	});
	t.like(
		readPackage(pkg(root, 'older', '1.0.0', {licenses: [{type: 'ISC'}]})),
		{license: 'ISC'},
	);
	t.like(readPackage(pkg(root, 'short', '1.0.0', {repository: 'github:o/r'})), {
		source: 'https://github.com/o/r',
	});
	t.like(
		readPackage(
			pkg(root, 'git', '1.0.0', {repository: 'git://github.com/o/r.git'}),
		),
		{source: 'https://github.com/o/r'},
	);
	t.like(readPackage(pkg(root, 'none', '1.0.0')), {
		license: undefined,
		source: undefined,
		files: [],
	});
});

test('REL-06 a nested tree is walked, scoped and nested packages included, in a stable order', t => {
	const root = tempDir();
	pkg(root, 'b', '1.0.0', {license: 'MIT'});
	pkg(root, '@s/z', '2.0.0', {license: 'MIT'});
	const a = pkg(root, 'a', '1.0.0', {license: 'MIT'});
	pkg(a, 'b', '0.9.0', {license: 'ISC'});
	t.deepEqual(
		collectTree(path.join(root, 'node_modules')).map(
			item => `${item.name}@${item.version}`,
		),
		['@s/z@2.0.0', 'a@1.0.0', 'b@0.9.0', 'b@1.0.0'],
	);
});

test('REL-06 SPDX expressions are allowed when any OR alternative or every AND part is allowed', t => {
	const allowed = ['MIT', 'ISC', 'Apache-2.0'];
	for (const id of [
		'MIT',
		'(MIT OR CC0-1.0)',
		'MIT AND ISC',
		'(GPL-3.0-only OR MIT)',
	])
		t.true(spdxAllowed(id, allowed), id);
	for (const id of [
		'GPL-3.0-or-later',
		'MIT AND GPL-3.0-only',
		'(GPL-2.0 OR LGPL-3.0)',
		'',
		undefined,
		'(MIT',
	])
		t.false(spdxAllowed(id, allowed), String(id));
});

test('REL-06 a package with no licence, a licence outside the policy or a copyleft licence is a problem unless excepted, and an exception that is no longer needed is reported', t => {
	const policy = {allowed: ['MIT'], exceptions: {'cfonts@3.3.1': 'reviewed'}};
	const make = (name, version, license) => ({
		name,
		version,
		license,
		files: [],
	});
	t.deepEqual(
		licenceProblems(
			[
				make('ok', '1.0.0', 'MIT'),
				make('none', '1.0.0', undefined),
				make('odd', '1.0.0', 'WTFPL'),
				make('cfonts', '3.3.1', 'GPL-3.0-or-later'),
			],
			policy,
		),
		[
			'none@1.0.0 declares no licence',
			'odd@1.0.0 has a licence outside the policy: WTFPL',
		],
	);
	t.deepEqual(licenceProblems([make('ok', '1.0.0', 'MIT')], policy), [
		'The exception for cfonts@3.3.1 is no longer needed',
	]);
});

test('REL-06 notices list every package once, sorted, with its licence texts, and say when a package ships none', t => {
	const text = renderNotices({
		title: 'Title',
		intro: 'Intro line',
		sections: [
			{
				heading: 'Section',
				packages: [
					{
						name: 'b',
						version: '1.0.0',
						license: 'MIT',
						source: 'https://x/b',
						files: [{name: 'LICENSE', text: 'B text'}],
					},
					{name: 'a', version: '2.0.0', license: 'ISC', files: []},
					{
						name: 'b',
						version: '1.0.0',
						license: 'MIT',
						source: 'https://x/b',
						files: [{name: 'LICENSE', text: 'B text'}],
					},
				],
			},
		],
	});
	t.true(text.startsWith('Title\n\nIntro line\n'));
	t.is(text.split('\nb 1.0.0\n').length, 2);
	t.true(text.indexOf('\na 2.0.0\n') < text.indexOf('\nb 1.0.0\n'));
	t.regex(text, /Licence: MIT\nSource: https:\/\/x\/b\n\nB text\n/);
	t.regex(
		text,
		/a 2\.0\.0\nLicence: ISC\n\nThis package ships no licence file; its package\.json declares ISC\. The ISC terms are at the end of this file\./,
	);
	t.regex(text, /ISC licence \(for packages that ship no licence file\)/);
	t.true(text.endsWith('\n'));
	t.is(
		text,
		renderNotices({
			title: 'Title',
			intro: 'Intro line',
			sections: [
				{
					heading: 'Section',
					packages: [
						{name: 'a', version: '2.0.0', license: 'ISC', files: []},
						{
							name: 'b',
							version: '1.0.0',
							license: 'MIT',
							source: 'https://x/b',
							files: [{name: 'LICENSE', text: 'B text'}],
						},
					],
				},
			],
		}),
	);
});

function shipped(options = {}) {
	const resources = tempDir();
	const nodeModules = path.join(resources, 'runtime', 'nanocoder');
	const nanocoder = pkg(
		nodeModules,
		'@nanocollective/nanocoder',
		'1.32.0',
		{license: 'MIT'},
		{'LICENSE.md': 'Copyright (c) 2025 Nano Collective\nMIT'},
	);
	pkg(nodeModules, 'dep', '1.0.0', {license: 'MIT'}, {LICENSE: 'Dep text'});
	mkdirSync(path.join(resources, 'runtime', 'node'), {recursive: true});
	writeFileSync(
		path.join(resources, 'runtime', 'node', 'LICENSE'),
		'Node licence',
	);
	writeFileSync(
		path.join(resources, 'THIRD-PARTY-NOTICES.txt'),
		'Desktop notices',
	);
	writeFileSync(path.join(resources, 'LICENSES.chromium.html'), '<html>');
	const listed = options.listed ?? [
		'@nanocollective/nanocoder 1.32.0',
		'dep 1.0.0',
	];
	writeFileSync(
		path.join(resources, 'runtime', 'THIRD-PARTY-NOTICES.txt'),
		`${listed.map(line => `\n${line}\n`).join('')}\nCopyright (c) 2025 Nano Collective\nMIT\n`,
	);
	return {resources, nanocoder};
}

test('REL-06 a shipped app with every notice in place has no problems', t => {
	t.deepEqual(verifyShippedNotices(shipped().resources), []);
});

test("REL-06 a shipped app is faulted for a missing file, a package left out, or Nanocoder's own licence missing", t => {
	const {resources} = shipped({listed: ['@nanocollective/nanocoder 1.32.0']});
	t.deepEqual(verifyShippedNotices(resources), [
		'runtime/THIRD-PARTY-NOTICES.txt does not list dep@1.0.0',
	]);
	const missing = shipped();
	rmSync(path.join(missing.resources, 'THIRD-PARTY-NOTICES.txt'));
	rmSync(path.join(missing.resources, 'runtime', 'node', 'LICENSE'));
	rmSync(path.join(missing.resources, 'LICENSES.chromium.html'));
	t.deepEqual(verifyShippedNotices(missing.resources).sort(), [
		'LICENSES.chromium.html is missing',
		'THIRD-PARTY-NOTICES.txt is missing or empty',
		'runtime/node/LICENSE is missing or empty',
	]);
	const bare = shipped();
	writeFileSync(
		path.join(bare.resources, 'runtime', 'THIRD-PARTY-NOTICES.txt'),
		'\n@nanocollective/nanocoder 1.32.0\n\ndep 1.0.0\n',
	);
	t.deepEqual(verifyShippedNotices(bare.resources), [
		"runtime/THIRD-PARTY-NOTICES.txt does not contain Nanocoder's own licence text",
	]);
});

test('REL-06 the licence policy lists no copyleft licence, and every exception states its reason', t => {
	const policy = JSON.parse(
		readFileSync(
			path.resolve(import.meta.dirname, '..', 'notice-policy.json'),
			'utf8',
		),
	);
	for (const id of policy.allowed)
		t.false(/GPL|AGPL|LGPL|SSPL|EUPL|CPAL|OSL/i.test(id), id);
	for (const [key, reason] of Object.entries(policy.exceptions)) {
		t.regex(key, /^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+/);
		t.true(reason.length >= 40, key);
	}
});
