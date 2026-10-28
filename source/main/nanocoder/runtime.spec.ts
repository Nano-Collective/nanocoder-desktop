import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	cliFromShim,
	pathDirectories,
	resolveNanocoder,
} from '@/main/nanocoder/runtime';

const temps: string[] = [];
const v22 = async () => 'v22.20.0';

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'nd-runtime-')));
	temps.push(dir);
	return dir;
}

function makePackage(
	root: string,
	{name = '@nanocollective/nanocoder', version = '1.31.0'} = {},
): string {
	mkdirSync(path.join(root, 'dist'), {recursive: true});
	const cli = path.join(root, 'dist', 'cli.js');
	writeFileSync(cli, '');
	chmodSync(cli, 0o755);
	writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({name, version, bin: {nanocoder: 'dist/cli.js'}}),
	);
	return cli;
}

function makeFile(file: string, content = ''): string {
	mkdirSync(path.dirname(file), {recursive: true});
	writeFileSync(file, content);
	chmodSync(file, 0o755);
	return file;
}

const symlinkTest = process.platform === 'win32' ? test.skip : test;

test.after.always(() => {
	for (const dir of temps) rmSync(dir, {recursive: true, force: true});
});

symlinkTest('resolves an npm global install linked from PATH', async t => {
	const prefix = tempDir();
	const cli = makePackage(
		path.join(prefix, 'lib', 'node_modules', '@nanocollective', 'nanocoder'),
	);
	mkdirSync(path.join(prefix, 'bin'));
	symlinkSync(
		'../lib/node_modules/@nanocollective/nanocoder/dist/cli.js',
		path.join(prefix, 'bin', 'nanocoder'),
	);
	symlinkSync(process.execPath, path.join(prefix, 'bin', 'node'));

	const result = await resolveNanocoder({
		env: {PATH: path.join(prefix, 'bin')},
		platform: process.platform,
		untrustedRoots: [],
	});

	t.true(result.ok);
	if (result.ok) {
		t.is(result.runtime.cliPath, cli);
		t.is(result.runtime.version, '1.31.0');
		t.is(result.runtime.source, 'path');
		t.is(result.runtime.nodePath, realpathSync(process.execPath));
		t.regex(result.runtime.nodeVersion, /^v\d+\./);
	}
});

test('follows the Windows npm .cmd wrapper without running it', async t => {
	const prefix = tempDir();
	const cli = makePackage(
		path.join(prefix, 'node_modules', '@nanocollective', 'nanocoder'),
	);
	makeFile(
		path.join(prefix, 'nanocoder.cmd'),
		'@ECHO off\r\nGOTO start\r\n:start\r\n"%_prog%"  "%dp0%\\node_modules\\@nanocollective\\nanocoder\\dist\\cli.js" %*\r\n',
	);
	makeFile(path.join(prefix, 'node.exe'));

	const result = await resolveNanocoder({
		env: {Path: prefix},
		platform: 'win32',
		untrustedRoots: [],
		readNodeVersion: v22,
	});

	t.true(result.ok);
	if (result.ok) {
		t.is(result.runtime.cliPath, cli);
		t.is(result.runtime.nodePath, path.join(prefix, 'node.exe'));
	}
});

test('reads the cli path from a pnpm shell wrapper', t => {
	const dir = tempDir();
	const shim = makeFile(
		path.join(dir, 'bin', 'nanocoder'),
		'#!/bin/sh\nexec node "$basedir/../global/5/node_modules/@nanocollective/nanocoder/dist/cli.js" "$@"\n',
	);
	t.is(
		cliFromShim(shim),
		path.join(
			dir,
			'global',
			'5',
			'node_modules',
			'@nanocollective',
			'nanocoder',
			'dist',
			'cli.js',
		),
	);
});

test('refuses a nanocoder inside the project folder', async t => {
	const project = tempDir();
	makePackage(
		path.join(project, 'node_modules', '@nanocollective', 'nanocoder'),
	);
	makeFile(
		path.join(project, 'node_modules', '.bin', 'nanocoder'),
		'#!/bin/sh\nexec node "$basedir/../@nanocollective/nanocoder/dist/cli.js" "$@"\n',
	);

	const result = await resolveNanocoder({
		env: {PATH: path.join(project, 'node_modules', '.bin')},
		platform: process.platform,
		untrustedRoots: [project],
		readNodeVersion: v22,
	});

	t.deepEqual(result, {
		ok: false,
		code: 'DENIED',
		message: 'Refusing a Nanocoder inside the project folder',
	});
});

test('refuses a Node.js inside the project folder', async t => {
	const project = tempDir();
	makeFile(
		path.join(
			project,
			'bin',
			process.platform === 'win32' ? 'node.exe' : 'node',
		),
	);

	const result = await resolveNanocoder({
		env: {
			PATH: path.join(project, 'bin'),
			NANOCODER_DESKTOP_CLI: makePackage(tempDir()),
		},
		platform: process.platform,
		untrustedRoots: [project],
		readNodeVersion: v22,
	});

	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'DENIED');
});

const resolveCli = (cli: string) =>
	resolveNanocoder({
		env: {NANOCODER_DESKTOP_CLI: cli},
		platform: process.platform,
		untrustedRoots: [],
		readNodeVersion: v22,
	});

test('finds no cli for a path that does not exist', async t => {
	const missing = path.join(tempDir(), 'dist', 'cli.js');
	const result = await resolveCli(missing);
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'NOT_FOUND');
	t.is(cliFromShim(path.join(tempDir(), 'no-such-shim')), undefined);
});

test('finds no cli when a wrapper points at a file that is missing', async t => {
	const dir = tempDir();
	const shim = makeFile(
		path.join(dir, 'nanocoder'),
		'exec node "$basedir/../lib/node_modules/@nanocollective/nanocoder/dist/cli.js" "$@"',
	);
	const result = await resolveCli(shim);
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'NOT_FOUND');
});

test('rejects a package with no package.json beside it', async t => {
	const dir = tempDir();
	const cli = makeFile(path.join(dir, 'dist', 'cli.js'));
	const result = await resolveCli(cli);
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'DENIED');
});

test('rejects a package whose bin is not the cli', async t => {
	const dir = tempDir();
	const cli = makePackage(dir);
	writeFileSync(
		path.join(dir, 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '1.31.0',
			bin: {nanocoder: 'dist/other.js'},
		}),
	);
	const result = await resolveCli(cli);
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'DENIED');
});

test('rejects a package that is not Nanocoder', async t => {
	const dir = tempDir();
	const cli = makePackage(dir, {name: '@someone/nanocoder'});

	const result = await resolveNanocoder({
		env: {NANOCODER_DESKTOP_CLI: cli},
		platform: process.platform,
		untrustedRoots: [],
		readNodeVersion: v22,
	});

	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'DENIED');
});

test('uses NANOCODER_DESKTOP_CLI and an absolute NANOCODER_DESKTOP_NODE', async t => {
	const dir = tempDir();
	const cli = makePackage(dir, {version: '1.32.0'});
	const node = makeFile(path.join(dir, 'runtime', 'node'));

	const result = await resolveNanocoder({
		env: {NANOCODER_DESKTOP_CLI: cli, NANOCODER_DESKTOP_NODE: node},
		platform: process.platform,
		untrustedRoots: [tempDir()],
		readNodeVersion: v22,
	});

	t.true(result.ok);
	if (result.ok) {
		t.is(result.runtime.source, 'override');
		t.is(result.runtime.version, '1.32.0');
		t.is(result.runtime.nodePath, node);
	}
});

test('rejects relative override paths', async t => {
	for (const env of [
		{NANOCODER_DESKTOP_CLI: 'dist/cli.js'},
		{
			NANOCODER_DESKTOP_CLI: makePackage(tempDir()),
			NANOCODER_DESKTOP_NODE: 'node',
		},
	]) {
		const result = await resolveNanocoder({
			env,
			platform: process.platform,
			untrustedRoots: [],
			readNodeVersion: v22,
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.code, 'DENIED');
	}
});

test('explicit overrides never bypass project-local CLI or Node refusal', async t => {
	for (const which of ['cli', 'node']) {
		const root = tempDir();
		let executed = false;
		const result = await resolveNanocoder({
			env: {
				NANOCODER_DESKTOP_CLI: makePackage(which === 'cli' ? root : tempDir()),
				NANOCODER_DESKTOP_NODE: makeFile(path.join(root, 'runtime', 'node')),
			},
			platform: process.platform,
			untrustedRoots: [root],
			readNodeVersion: async () => {
				executed = true;
				return 'v22.0.0';
			},
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.code, 'DENIED');
		t.false(executed);
	}
});

test('true-cased and case-aliased project runtimes are refused before execution', async t => {
	const work = tempDir();
	const root = path.join(work, 'CaseProject');
	const alias = path.join(work, 'caseproject');
	mkdirSync(root);
	const cli = makePackage(path.join(root, 'nanocoder'));
	const marker = path.join(work, 'controlled-probe-ran');
	const node = makeFile(
		path.join(root, 'bin', 'node'),
		`#!${realpathSync.native(process.execPath)}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fixture');\nconsole.log('v24.0.0');\n`,
	);
	const spellings = existsSync(alias) ? [root, alias] : [root];
	for (const spelling of spellings) {
		for (const which of ['cli', 'node']) {
			const result = await resolveNanocoder({
				env: {
					NANOCODER_DESKTOP_CLI:
						which === 'cli'
							? path.join(spelling, 'nanocoder/dist/cli.js')
							: makePackage(tempDir()),
					NANOCODER_DESKTOP_NODE:
						which === 'node'
							? path.join(spelling, 'bin/node')
							: process.execPath,
				},
				platform: process.platform,
				untrustedRoots: [root],
			});
			t.false(result.ok, which);
			if (!result.ok) t.is(result.code, 'DENIED');
		}
	}
	t.false(existsSync(marker));
	if (!existsSync(alias)) {
		mkdirSync(alias);
		const result = await resolveNanocoder({
			env: {
				NANOCODER_DESKTOP_CLI: makePackage(path.join(alias, 'nanocoder')),
				NANOCODER_DESKTOP_NODE: makeFile(path.join(alias, 'bin/node')),
			},
			platform: process.platform,
			untrustedRoots: [root],
			readNodeVersion: v22,
		});
		t.true(result.ok);
	}
	t.true(existsSync(cli));
	t.true(existsSync(node));
});

test('overrides in ..tools never reach the Node version probe', async t => {
	for (const which of ['cli', 'node']) {
		const root = tempDir();
		const tools = path.join(root, '..tools');
		const localCli = makePackage(path.join(tools, 'nanocoder'));
		const localNode = makeFile(path.join(tools, 'node'));
		let probed = false;
		const result = await resolveNanocoder({
			env: {
				NANOCODER_DESKTOP_CLI:
					which === 'cli' ? localCli : makePackage(tempDir()),
				NANOCODER_DESKTOP_NODE: which === 'node' ? localNode : process.execPath,
			},
			platform: process.platform,
			untrustedRoots: [root],
			readNodeVersion: async () => {
				probed = true;
				return 'v24.0.0';
			},
		});
		t.false(result.ok, which);
		if (!result.ok) {
			t.is(result.code, 'DENIED');
			t.regex(result.message, /inside the project folder/);
		}
		t.false(probed);
	}
});

symlinkTest(
	'a real project-local ..tools/node cannot run even its version probe',
	async t => {
		const root = tempDir();
		const marker = path.join(tempDir(), 'controlled-node-probe-ran');
		const node = makeFile(
			path.join(root, '..tools', 'node'),
			`#!${realpathSync(process.execPath)}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fixture');\nconsole.log('v24.0.0');\n`,
		);
		const result = await resolveNanocoder({
			env: {
				NANOCODER_DESKTOP_CLI: makePackage(tempDir()),
				NANOCODER_DESKTOP_NODE: node,
			},
			platform: process.platform,
			untrustedRoots: [root],
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.code, 'DENIED');
		t.false(existsSync(marker));
	},
);

test('PATH discovery refuses CLI and Node targets inside ..tools', async t => {
	for (const which of ['cli', 'node']) {
		const root = tempDir();
		const tools = path.join(root, '..tools');
		const bin = path.join(tools, 'bin');
		makePackage(
			path.join(tools, 'node_modules', '@nanocollective', 'nanocoder'),
		);
		makeFile(
			path.join(
				bin,
				process.platform === 'win32' ? 'nanocoder.cmd' : 'nanocoder',
			),
			'exec node "$basedir/../node_modules/@nanocollective/nanocoder/dist/cli.js"',
		);
		makeFile(
			path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node'),
		);
		let probed = false;
		const result = await resolveNanocoder({
			env: {
				PATH: bin,
				...(which === 'node'
					? {NANOCODER_DESKTOP_CLI: makePackage(tempDir())}
					: {}),
			},
			platform: process.platform,
			untrustedRoots: [root],
			readNodeVersion: async () => {
				probed = true;
				return 'v24.0.0';
			},
		});
		t.false(result.ok, which);
		if (!result.ok) t.is(result.code, 'DENIED');
		t.false(probed);
	}
});

test('a sibling sharing the project prefix is not a project-local runtime', async t => {
	const work = tempDir();
	const root = path.join(work, 'project');
	mkdirSync(root);
	const sibling = path.join(work, 'project-other');
	const result = await resolveNanocoder({
		env: {
			NANOCODER_DESKTOP_CLI: makePackage(sibling),
			NANOCODER_DESKTOP_NODE: makeFile(path.join(sibling, 'node')),
		},
		platform: process.platform,
		untrustedRoots: [root],
		readNodeVersion: v22,
	});
	t.true(result.ok);
});

test('unavailable or relative excluded roots fail closed before version probing', async t => {
	for (const root of [path.join(tempDir(), 'missing'), 'relative']) {
		let probed = false;
		const result = await resolveNanocoder({
			env: {
				NANOCODER_DESKTOP_CLI: makePackage(tempDir()),
				NANOCODER_DESKTOP_NODE: process.execPath,
			},
			platform: process.platform,
			untrustedRoots: [root],
			readNodeVersion: async () => {
				probed = true;
				return 'v24.0.0';
			},
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.code, 'DENIED');
		t.false(probed);
	}
});

symlinkTest(
	'excluded roots are canonicalised before comparing runtime targets',
	async t => {
		const root = tempDir();
		const alias = path.join(tempDir(), 'project-link');
		symlinkSync(root, alias, 'dir');
		const result = await resolveNanocoder({
			env: {
				NANOCODER_DESKTOP_CLI: makePackage(
					path.join(root, '..tools', 'nanocoder'),
				),
				NANOCODER_DESKTOP_NODE: process.execPath,
			},
			platform: process.platform,
			untrustedRoots: [alias],
			readNodeVersion: v22,
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.code, 'DENIED');
	},
);

symlinkTest(
	'refuses outside override links whose CLI or Node target is inside the project',
	async t => {
		for (const which of ['cli', 'node']) {
			const root = tempDir();
			const outside = tempDir();
			const cli = makePackage(
				which === 'cli' ? path.join(root, '..tools', 'nanocoder') : outside,
			);
			const node = makeFile(path.join(root, '..tools', 'node'));
			const link = path.join(tempDir(), which === 'cli' ? 'cli.js' : 'node');
			symlinkSync(which === 'cli' ? cli : node, link);
			let executed = false;
			const result = await resolveNanocoder({
				env: {
					NANOCODER_DESKTOP_CLI: which === 'cli' ? link : cli,
					NANOCODER_DESKTOP_NODE: which === 'node' ? link : process.execPath,
				},
				platform: process.platform,
				untrustedRoots: [root],
				readNodeVersion: async () => {
					executed = true;
					return 'v22.0.0';
				},
			});
			t.false(result.ok);
			if (!result.ok) t.is(result.code, 'DENIED');
			t.false(executed);
		}
	},
);

test('rejects Node.js older than 22', async t => {
	const dir = tempDir();
	const result = await resolveNanocoder({
		env: {
			NANOCODER_DESKTOP_CLI: makePackage(dir),
			NANOCODER_DESKTOP_NODE: makeFile(path.join(dir, 'node')),
		},
		platform: process.platform,
		untrustedRoots: [],
		readNodeVersion: async () => 'v20.11.0',
	});
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'UNSUPPORTED');
});

test('reports a Node.js that cannot run', async t => {
	const dir = tempDir();
	const result = await resolveNanocoder({
		env: {
			NANOCODER_DESKTOP_CLI: makePackage(dir),
			NANOCODER_DESKTOP_NODE: makeFile(path.join(dir, 'node')),
		},
		platform: process.platform,
		untrustedRoots: [],
		readNodeVersion: async () => {
			throw new Error('spawn failed');
		},
	});
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'UNSUPPORTED');
});

test('reports NOT_FOUND when Nanocoder or Node.js is missing', async t => {
	const empty = tempDir();
	const missingCli = await resolveNanocoder({
		env: {PATH: empty},
		platform: process.platform,
		untrustedRoots: [],
		readNodeVersion: v22,
	});
	t.false(missingCli.ok);
	if (!missingCli.ok) t.is(missingCli.code, 'NOT_FOUND');

	const missingNode = await resolveNanocoder({
		env: {PATH: empty, NANOCODER_DESKTOP_CLI: makePackage(tempDir())},
		platform: process.platform,
		untrustedRoots: [],
		readNodeVersion: v22,
	});
	t.false(missingNode.ok);
	if (!missingNode.ok) t.is(missingNode.code, 'NOT_FOUND');
});

test('drops relative PATH entries', t => {
	const absolute = path.resolve('bin');
	t.deepEqual(
		pathDirectories({PATH: ['relative', '', absolute].join(path.delimiter)}),
		[absolute],
	);
});

test('an aborted lookup never starts its runtime version probe', async t => {
	const abort = new AbortController();
	abort.abort(new Error('fake quit'));
	let probed = false;
	await t.throwsAsync(
		resolveNanocoder({
			env: {},
			platform: process.platform,
			untrustedRoots: [],
			signal: abort.signal,
			readNodeVersion: async () => {
				probed = true;
				return 'v22.0.0';
			},
		}),
		{message: 'fake quit'},
	);
	t.false(probed);
});

test('the actual Node version subprocess is cancelled with its lookup', async t => {
	const abort = new AbortController();
	const pending = resolveNanocoder({
		env: {
			NANOCODER_DESKTOP_CLI: makePackage(tempDir()),
			NANOCODER_DESKTOP_NODE: process.execPath,
		},
		platform: process.platform,
		untrustedRoots: [],
		signal: abort.signal,
	});
	abort.abort();
	const result = await pending;
	t.false(result.ok);
	if (!result.ok) t.is(result.code, 'UNSUPPORTED');
});
