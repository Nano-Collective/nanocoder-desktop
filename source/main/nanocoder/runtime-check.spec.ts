import {spawn} from 'node:child_process';
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
import {bundledRuntimePaths} from '@/main/nanocoder/runtime';
import {checkPackagedRuntime} from '@/main/nanocoder/runtime-check';

const temps: string[] = [];
test.after.always(() => {
	for (const dir of temps) rmSync(dir, {recursive: true, force: true});
});

const dir = () => {
	const made = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-check-')),
	);
	temps.push(made);
	return made;
};

// A bundle whose Node is this test's own Node and whose Nanocoder only prints its version.
function bundle(version = '1.32.0') {
	const resources = dir();
	const paths = bundledRuntimePaths(resources, process.platform);
	const root = path.resolve(paths.cliPath, '..', '..');
	mkdirSync(path.dirname(paths.cliPath), {recursive: true});
	writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version,
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	writeFileSync(
		paths.cliPath,
		`if (process.argv[2] === '--version') console.log(${JSON.stringify(version)});`,
	);
	mkdirSync(path.dirname(paths.nodePath), {recursive: true});
	symlinkSync(process.execPath, paths.nodePath);
	chmodSync(paths.nodePath, 0o755);
	return {resources};
}

const symlinkTest = process.platform === 'win32' ? test.skip : test;

symlinkTest(
	'REL-02 REL-04 the packaged runtime resolves to the bundle, runs, and reports its versions',
	async t => {
		const {resources} = bundle();
		const result = await checkPackagedRuntime({
			resourcesPath: resources,
			platform: process.platform,
			env: {PATH: ''},
			workDir: dir(),
		});
		t.like(result, {ok: true, source: 'bundled', version: '1.32.0'});
		if (result.ok) t.regex(result.nodeVersion, /^v\d+\./);
	},
);

symlinkTest(
	'SEC-05 the launcher drops NODE_OPTIONS, and the check proves the poison would have run',
	async t => {
		const {resources} = bundle();
		const work = dir();
		const result = await checkPackagedRuntime({
			resourcesPath: resources,
			platform: process.platform,
			env: {PATH: ''},
			workDir: work,
		});
		t.true(result.ok);
		if (result.ok) t.true(result.poisonControl);
		t.false(existsSync(path.join(work, 'poison-ran')));
	},
);

symlinkTest(
	'SEC-05 a launcher that lets NODE_OPTIONS through fails the check',
	async t => {
		const {resources} = bundle();
		const result = await checkPackagedRuntime({
			resourcesPath: resources,
			platform: process.platform,
			env: {PATH: ''},
			workDir: dir(),
			// Passes the environment on unfiltered, like a launcher without the rule.
			launch: (runtime, args, cwd, env) =>
				spawn(runtime.nodePath, [runtime.cliPath, ...args], {
					cwd,
					env,
					stdio: ['pipe', 'pipe', 'pipe'],
				}),
		});
		t.false(result.ok);
		if (!result.ok) t.regex(result.reason, /NODE_OPTIONS/);
	},
);

test('REL-02 a missing bundle fails with the resolver reason, and an override is not the bundle', async t => {
	const missing = await checkPackagedRuntime({
		resourcesPath: dir(),
		platform: process.platform,
		env: {PATH: ''},
		workDir: dir(),
	});
	t.false(missing.ok);
	if (!missing.ok) t.regex(missing.reason, /bundled Nanocoder is missing/);
	const {resources} = bundle();
	const overridden = await checkPackagedRuntime({
		resourcesPath: resources,
		platform: process.platform,
		env: {
			NANOCODER_DESKTOP_CLI: bundledRuntimePaths(resources, process.platform)
				.cliPath,
		},
		workDir: dir(),
	});
	t.false(overridden.ok);
	if (!overridden.ok) t.regex(overridden.reason, /override/);
});
