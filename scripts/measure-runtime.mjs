import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {
	appendFileSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {
	classifyInitializeReply,
	formatReport,
	measurementEnv,
	nodeBinaryPath,
	parseResidentKb,
	pinnedArchive,
	summarise,
} from './lib/runtime.mjs';

// Phase G.6: runs `nanocoder --acp` under Electron's Node mode and under the pinned Node sidecar,
// and records PERF-02 (spawn to `initialize` answered), idle memory and failures for each.
// Usage: node scripts/measure-runtime.mjs --cli /absolute/path/to/nanocoder/dist/cli.js [--runs 5]
// The fixtures are throwaway: a temporary Nanocoder config and data folder, trusted once by a
// separate trust launch, as the desktop does (DEC-30), so the measured launches set nothing.
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const cli = option('cli', process.env.NANOCODER_CLI);
if (!cli || !path.isAbsolute(cli)) {
	throw new Error('Pass --cli with the absolute path to nanocoder dist/cli.js');
}
const runs = Number(option('runs', '5'));
const SETTLE_MS = 2000;
const TIMEOUT_MS = 60_000;

const pin = JSON.parse(
	readFileSync(new URL('./node-sidecar.json', import.meta.url), 'utf8'),
);
const cacheDir = path.resolve('.cache', 'node-sidecar');
const {key} = pinnedArchive(pin, process.platform, process.arch);
const sidecar = nodeBinaryPath(cacheDir, pin.version, key, process.platform);
const electron = createRequire(import.meta.url)('electron');

const work = realpathSync(mkdtempSync(path.join(tmpdir(), 'nd-measure-')));
const project = path.join(work, 'project');
mkdirSync(project);
mkdirSync(path.join(work, 'config'));
writeFileSync(
	path.join(work, 'config', 'agents.config.json'),
	JSON.stringify({
		nanocoder: {
			providers: [
				{
					name: 'Offline',
					baseUrl: 'http://127.0.0.1:9/v1',
					models: ['offline-model'],
				},
			],
		},
	}),
);

const baseEnv = measurementEnv(process.env);
const env = {
	...baseEnv,
	NANOCODER_CONFIG_DIR: path.join(work, 'config'),
	NANOCODER_DATA_DIR: path.join(work, 'data'),
};

function residentKb(pid) {
	const [command, commandArgs] =
		process.platform === 'win32'
			? ['tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']]
			: ['ps', ['-o', 'rss=', '-p', String(pid)]];
	try {
		return parseResidentKb(
			execFileSync(command, commandArgs, {encoding: 'utf8'}),
			process.platform,
		);
	} catch {
		return undefined;
	}
}

// One launch: time to `initialize`, then memory after the process has settled.
function launch(runtime, extraEnv = {}) {
	return new Promise(resolve => {
		const started = performance.now();
		const child = spawn(runtime, [cli, '--acp'], {
			cwd: project,
			env: {...env, ...extraEnv},
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		let message = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', chunk => {
			const own = chunk
				.split(/\r?\n/)
				.find(line => line.startsWith('[nanocoder] '));
			if (own) message = own.slice('[nanocoder] '.length, 160);
		});
		child.stdin.on('error', () => {});
		let settled = false;
		const finish = result => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.stdin.end();
			child.kill();
			resolve(result);
		};
		const timer = setTimeout(
			() => finish({ok: false, reason: 'no answer within 60 seconds'}),
			TIMEOUT_MS,
		);
		child.on('error', error =>
			finish({
				ok: false,
				reason: `could not start: ${error.code ?? error.message}`,
			}),
		);
		child.on('close', code =>
			finish({ok: false, reason: message || `exited with code ${code}`}),
		);
		createInterface({input: child.stdout}).on('line', line => {
			const reply = classifyInitializeReply(line);
			if (reply.kind === 'ignore') return;
			if (reply.kind === 'failed') {
				return finish({ok: false, reason: reply.reason});
			}
			const startupMs = performance.now() - started;
			setTimeout(
				() => finish({ok: true, startupMs, residentKb: residentKb(child.pid)}),
				SETTLE_MS,
			);
		});
		child.stdin.write(
			`${JSON.stringify({jsonrpc: '2.0', id: 0, method: 'initialize', params: {protocolVersion: 1}})}\n`,
		);
	});
}

async function measure(name, runtime, extraEnv) {
	const version = spawnSync(runtime, ['-p', 'process.versions.node'], {
		env: {...baseEnv, ...extraEnv},
		encoding: 'utf8',
	}).stdout?.trim();
	const results = [];
	for (let run = 0; run < runs; run++)
		results.push(await launch(runtime, extraEnv));
	const good = results.filter(result => result.ok);
	return {
		name,
		node: version || 'unknown',
		runs,
		failures: results.length - good.length,
		failureReasons: [...new Set(results.filter(r => !r.ok).map(r => r.reason))],
		startupMs: summarise(good.map(result => result.startupMs)),
		residentMb: summarise(
			good
				.map(result => result.residentKb)
				.filter(Boolean)
				.map(kb => kb / 1024),
		),
	};
}

// A machine without Node: the sidecar must not need `node` on PATH.
async function withoutNodeOnPath(runtime, extraEnv = {}) {
	const systemDirs =
		process.platform === 'win32'
			? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')]
			: ['/usr/bin', '/bin'];
	const bare = {PATH: systemDirs.join(path.delimiter)};
	const probe = spawnSync('node', ['-v'], {env: bare});
	if (!probe.error?.code) return {valid: false};
	return {valid: true, result: await launch(runtime, {...extraEnv, ...bare})};
}

// macOS: does the sidecar start under the hardened runtime, and with which entitlements?
async function hardenedRuntime() {
	const attempts = [
		['no entitlements', []],
		['allow-jit', ['com.apple.security.cs.allow-jit']],
		[
			'allow-jit and allow-unsigned-executable-memory',
			[
				'com.apple.security.cs.allow-jit',
				'com.apple.security.cs.allow-unsigned-executable-memory',
			],
		],
	];
	const outcomes = [];
	for (const [label, entitlements] of attempts) {
		const copy = path.join(work, `node-${outcomes.length}`);
		copyFileSync(sidecar, copy);
		const plist = path.join(work, `entitlements-${outcomes.length}.plist`);
		writeFileSync(
			plist,
			`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entitlements.map(key => `<key>${key}</key><true/>`).join('')}</dict></plist>\n`,
		);
		try {
			execFileSync(
				'codesign',
				[
					'--force',
					'--options',
					'runtime',
					'--entitlements',
					plist,
					'--sign',
					'-',
					copy,
				],
				{stdio: 'pipe'},
			);
		} catch (error) {
			outcomes.push({
				label,
				ok: false,
				reason: `codesign failed: ${error.status ?? error.code}`,
			});
			continue;
		}
		const result = await launch(copy);
		outcomes.push({label, ok: result.ok, reason: result.reason});
	}
	return outcomes;
}

// One trust launch with the variable set and stdin closed, like the desktop's (DEC-30).
await new Promise(resolve => {
	const trust = spawn(sidecar, [cli, '--acp'], {
		cwd: project,
		env: {...env, NANOCODER_TRUST_DIRECTORY: '1'},
		stdio: ['pipe', 'ignore', 'ignore'],
		windowsHide: true,
	});
	trust.stdin.end();
	const timer = setTimeout(() => trust.kill(), TIMEOUT_MS);
	trust.on('close', () => {
		clearTimeout(timer);
		resolve();
	});
	trust.on('error', resolve);
});

const sidecarBytes = statSync(sidecar).size;
const report = {
	platform: `${process.platform}-${process.arch}`,
	nanocoder: cli,
	sidecar: {version: pin.version, binaryBytes: sidecarBytes},
	runtimes: [
		await measure('Electron Node mode', electron, {ELECTRON_RUN_AS_NODE: '1'}),
		await measure('Node sidecar', sidecar, {}),
	],
	noNodeOnPath: {
		'Electron Node mode': await withoutNodeOnPath(electron, {
			ELECTRON_RUN_AS_NODE: '1',
		}).then(r =>
			r.valid ? {ok: r.result.ok, reason: r.result.reason} : {valid: false},
		),
		'Node sidecar': await withoutNodeOnPath(sidecar).then(r =>
			r.valid ? {ok: r.result.ok, reason: r.result.reason} : {valid: false},
		),
	},
	hardenedRuntime:
		process.platform === 'darwin' ? await hardenedRuntime() : null,
};
rmSync(work, {recursive: true, force: true});

const text = formatReport(report, pin.version);
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) {
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}
console.log(JSON.stringify(report));
