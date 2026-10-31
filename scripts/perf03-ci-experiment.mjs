// EXPERIMENT ONLY. Never merge this runner or its probes into a product branch.

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const base = '58e42300e0c2177203bea8f5bdb7a442eb3b72a8';
const root = path.resolve(import.meta.dirname, '..');
const experimentRoot = path.join(root, '.qa/perf03-experiment');
const artifacts = path.join(experimentRoot, 'artifacts');
const probePath = path.join(root, 'source/renderer/perf03-experiment.ts');
const testPath = path.join(root, 'e2e/replay-gates.e2e.ts');
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (file, value) => {
	mkdirSync(path.dirname(file), {recursive: true});
	writeFileSync(file, JSON.stringify(value, null, 2));
};

export function variantSource(source, variant) {
	if (!['A', 'B'].includes(variant)) throw new Error('Invalid variant');
	const needle = "\treturn 'A';";
	if (source.split(needle).length !== 2)
		throw new Error('Variant patch must match exactly one literal');
	return source.replace(needle, `\treturn '${variant}';`);
}

export function budgetFailures(metrics) {
	if (!metrics || metrics.messages !== 200) return ['missing metrics'];
	const names = [
		'prefixMs',
		'usableMs',
		'inputMs',
		'scrollMs',
		'frameMs',
		'eventLoopMs',
	];
	if (names.some(name => !Number.isFinite(metrics[name]) || metrics[name] < 0))
		return ['invalid metrics'];
	return names
		.filter(name => name !== 'prefixMs')
		.filter(name => metrics[name] > (name === 'usableMs' ? 2000 : 100));
}

export function responseWindows(snapshot) {
	const pairs = [
		['usable', 'replay-complete', 'controls-usable'],
		['input', 'input-start', 'input-end'],
		['scroll', 'scroll-start', 'scroll-end'],
		['frame', 'frame-first', 'frame-second'],
		['loop', 'loop-start', 'loop-end'],
	];
	return pairs.flatMap(([metric, startKind, endKind]) => {
		const starts = snapshot.events.filter(event => event.kind === startKind);
		const ends = snapshot.events.filter(event => event.kind === endKind);
		return starts.flatMap((start, index) => {
			const end = ends[index];
			if (!end || end.at < start.at) return [];
			const overlaps = snapshot.events.filter(event => {
				if (event.kind === 'longtask')
					return event.at < end.at && event.at + event.duration > start.at;
				return (
					event.at >= start.at &&
					event.at <= end.at &&
					['recents-read-resolved', 'recents-react-commit'].includes(event.kind)
				);
			});
			return [{metric, start: start.at, end: end.at, overlaps}];
		});
	});
}

function git(...args) {
	const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
	if (result.status !== 0) throw new Error(`Git command failed: ${args[0]}`);
	return result.stdout.trim();
}

function files(directory) {
	return readdirSync(directory, {withFileTypes: true})
		.flatMap(entry => {
			const file = path.join(directory, entry.name);
			return entry.isDirectory() ? files(file) : [file];
		})
		.sort();
}

function unchangedBudgets() {
	const extract = source => {
		const begin = source.indexOf('expect(metrics.usableMs)');
		const end = source.indexOf("await test.step('apply an actual", begin);
		if (begin < 0 || end < 0) throw new Error('Missing original assertions');
		return source.slice(begin, end);
	};
	const original = extract(git('show', `${base}:e2e/replay-gates.e2e.ts`));
	const current = extract(readFileSync(testPath, 'utf8'));
	if (original !== current) throw new Error('PERF-03 assertions were changed');
	return hash(original);
}

function build() {
	mkdirSync(artifacts, {recursive: true});
	const source = readFileSync(probePath, 'utf8');
	const manifest = {
		base,
		head: git('rev-parse', 'HEAD'),
		assertionsSha256: unchangedBudgets(),
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		release: os.release(),
		variants: {},
	};
	writeFileSync(
		path.join(artifacts, 'variant-b.patch'),
		"--- a/source/renderer/perf03-experiment.ts\n+++ b/source/renderer/perf03-experiment.ts\n@@ -3 +3 @@\n-\treturn 'A';\n+\treturn 'B';\n",
	);
	try {
		for (const variant of ['A', 'B']) {
			const modified = variantSource(source, variant);
			writeFileSync(probePath, modified);
			const result = spawnSync('pnpm', ['build'], {
				cwd: root,
				encoding: 'utf8',
				maxBuffer: 8 * 1024 * 1024,
			});
			writeFileSync(
				path.join(artifacts, `build-${variant}.log`),
				`${result.stdout ?? ''}${result.stderr ?? ''}`,
			);
			if (result.status !== 0) throw new Error(`Build ${variant} failed`);
			const target = path.join(experimentRoot, 'builds', variant);
			rmSync(target, {recursive: true, force: true});
			cpSync(path.join(root, 'out'), target, {recursive: true});
			manifest.variants[variant] = {
				probeSha256: hash(modified),
				files: files(target).map(file => ({
					file: path.relative(target, file),
					sha256: hash(readFileSync(file)),
				})),
			};
		}
	} finally {
		writeFileSync(probePath, source);
	}
	save(path.join(artifacts, 'manifest.json'), manifest);
	console.info('Built both experiment variants with unchanged assertions');
}

function run(pairs) {
	if (process.platform !== 'darwin') throw new Error('macOS only experiment');
	if (!Number.isInteger(pairs) || pairs < 1 || (process.env.CI && pairs < 10))
		throw new Error('CI needs at least ten complete A/B pairs');
	const results = [];
	for (let round = 1; round <= pairs; round++) {
		for (const variant of ['A', 'B']) {
			const label = `${String(round).padStart(2, '0')}-${variant}`;
			const output = path.join(artifacts, 'runs', label);
			const sandbox = path.join(experimentRoot, 'sandboxes', label);
			rmSync(output, {recursive: true, force: true});
			mkdirSync(output, {recursive: true});
			rmSync(path.join(root, 'out'), {recursive: true, force: true});
			cpSync(
				path.join(experimentRoot, 'builds', variant),
				path.join(root, 'out'),
				{recursive: true},
			);
			const env = {
				...process.env,
				NANOCODER_CLI: '',
				NANOCODER_E2E_VISIBLE: '',
				HOME: path.join(sandbox, 'home'),
				USERPROFILE: path.join(sandbox, 'home'),
				XDG_CONFIG_HOME: path.join(sandbox, 'config'),
				XDG_DATA_HOME: path.join(sandbox, 'data'),
				APPDATA: path.join(sandbox, 'appdata'),
				LOCALAPPDATA: path.join(sandbox, 'localappdata'),
				NANOCODER_CONFIG_DIR: path.join(sandbox, 'config'),
				NANOCODER_DATA_DIR: path.join(sandbox, 'data'),
				NANOCODER_DESKTOP_CLI: path.join(sandbox, 'unavailable/dist/cli.js'),
			};
			for (const key of [
				'HOME',
				'XDG_CONFIG_HOME',
				'XDG_DATA_HOME',
				'APPDATA',
				'LOCALAPPDATA',
			])
				mkdirSync(env[key], {recursive: true});
			const startedAt = new Date().toISOString();
			const child = spawnSync(
				'pnpm',
				[
					'exec',
					'playwright',
					'test',
					'e2e/replay-gates.e2e.ts',
					'--grep',
					'mounted replay complete',
					'--workers',
					'1',
					'--output',
					path.join(output, 'test-results'),
				],
				{cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024},
			);
			const generated = files(output);
			const read = name => {
				const file = generated.find(file => path.basename(file) === name);
				return file ? JSON.parse(readFileSync(file, 'utf8')) : null;
			};
			const metrics = read('perf03.json');
			const snapshot = read('perf03-experiment.json');
			writeFileSync(
				path.join(output, 'run.log'),
				JSON.stringify({
					round,
					variant,
					exitCode: child.status,
					signal: child.signal,
					spawnErrorCode: child.error?.code ?? null,
					metrics,
					snapshot,
				}),
			);
			const invalidCapture =
				!snapshot ||
				snapshot.variant !== variant ||
				!snapshot.longTasksSupported ||
				snapshot.measurementEnd === null ||
				snapshot.dropped !== 0;
			const result = {
				round,
				variant,
				startedAt,
				exitCode: child.status,
				signal: child.signal,
				budgetFailures: budgetFailures(metrics),
				invalidCapture,
				metrics,
				snapshot,
				windows: snapshot ? responseWindows(snapshot) : [],
			};
			results.push(result);
			save(path.join(artifacts, 'summary.json'), {base, pairs, results});
			console.info(
				'PERF03-EXPERIMENT-RESULT',
				JSON.stringify({
					round,
					variant,
					exitCode: child.status,
					budgetFailures: result.budgetFailures,
					invalidCapture,
					metrics,
				}),
			);
			rmSync(sandbox, {recursive: true, force: true});
		}
	}
	if (
		results.some(
			result =>
				result.exitCode !== 0 ||
				result.invalidCapture ||
				result.budgetFailures.length > 0,
		)
	)
		process.exitCode = 1;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const mode = process.argv[2];
	if (!process.version.startsWith('v22.'))
		throw new Error('Run this experiment under Node 22');
	if (mode === 'build') build();
	else if (mode === 'run') {
		const index = process.argv.indexOf('--pairs');
		run(index < 0 ? 10 : Number(process.argv[index + 1]));
	} else throw new Error('Expected build or run');
}
