import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {bundledLayout} from './lib/bundle.mjs';

const release = path.resolve('release');
const root = path.resolve(import.meta.dirname, '..');
const pin = JSON.parse(
	readFileSync(path.join(root, 'scripts', 'nanocoder-bundle.json'), 'utf8'),
);
const nodePin = JSON.parse(
	readFileSync(path.join(root, 'scripts', 'node-sidecar.json'), 'utf8'),
);
const REPLY = 'packaged smoke ok';

function findExecutable() {
	if (process.platform === 'linux') {
		return path.join(release, 'linux-unpacked', 'nanocoder-desktop');
	}
	if (process.platform === 'win32') {
		const dir = path.join(release, 'win-unpacked');
		const exes = readdirSync(dir).filter(name => name.endsWith('.exe'));
		const named = exes.find(name =>
			/^(nanocoder-desktop|Nanocoder Desktop)\.exe$/.test(name),
		);
		return path.join(dir, named ?? exes[0] ?? 'missing.exe');
	}
	const app = readdirSync(release, {withFileTypes: true})
		.filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
		.flatMap(entry =>
			readdirSync(path.join(release, entry.name))
				.filter(name => name.endsWith('.app'))
				.map(name => path.join(release, entry.name, name)),
		)[0];
	if (!app) {
		return path.join(release, 'missing.app');
	}
	const binDir = path.join(app, 'Contents', 'MacOS');
	return path.join(binDir, readdirSync(binDir)[0] ?? 'missing');
}

function resourcesOf(executable) {
	return process.platform === 'darwin'
		? path.resolve(executable, '..', '..', 'Resources')
		: path.join(path.dirname(executable), 'resources');
}

// The environment of a machine with no Node, npm or Nanocoder: only the system's own folders on PATH.
function bareEnvironment() {
	const env = {...process.env};
	for (const key of Object.keys(env)) {
		if (/^(node_|npm_|pnpm_|nanocoder_)/i.test(key)) delete env[key];
	}
	// The PATH of a stock Windows or Unix machine, which holds no Node.
	const system = process.env.SystemRoot ?? 'C:\\Windows';
	env.PATH =
		process.platform === 'win32'
			? [
					path.join(system, 'System32'),
					system,
					path.join(system, 'System32', 'Wbem'),
					path.join(system, 'System32', 'WindowsPowerShell', 'v1.0'),
				].join(path.delimiter)
			: '/usr/bin:/bin';
	return env;
}

function nodeOnPath(env) {
	try {
		return execFileSync(
			process.platform === 'win32' ? 'where.exe' : 'which',
			['node'],
			{env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
		).trim();
	} catch {
		return undefined;
	}
}

// An OpenAI-compatible endpoint that answers every request with one fixed reply.
async function startProvider() {
	const chunk = (delta, finish = null) =>
		`data: ${JSON.stringify({
			id: 'chatcmpl-smoke',
			object: 'chat.completion.chunk',
			created: 0,
			model: 'smoke-model',
			choices: [{index: 0, delta, finish_reason: finish}],
		})}\n\n`;
	const server = createServer((request, response) => {
		const chunks = [];
		request.on('data', part => chunks.push(part));
		request.on('end', () => {
			let body = {};
			try {
				body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch {}
			if (body.stream === false) {
				response.writeHead(200, {'content-type': 'application/json'});
				response.end(
					JSON.stringify({
						id: 'chatcmpl-smoke',
						object: 'chat.completion',
						created: 0,
						model: 'smoke-model',
						choices: [
							{
								index: 0,
								message: {role: 'assistant', content: REPLY},
								finish_reason: 'stop',
							},
						],
						usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
					}),
				);
				return;
			}
			response.writeHead(200, {'content-type': 'text/event-stream'});
			response.end(
				`${chunk({role: 'assistant', content: REPLY})}${chunk({}, 'stop')}data: [DONE]\n\n`,
			);
		});
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	return {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
		close: () =>
			new Promise(resolve => {
				server.closeAllConnections();
				server.close(resolve);
			}),
	};
}

// Speaks ACP to the bundled Nanocoder over stdio, which is all the desktop does too.
async function runTurn(resources, env, project) {
	const layout = bundledLayout(process.platform);
	const runtime = path.join(resources, 'runtime');
	const child = spawn(
		path.join(runtime, ...layout.node),
		[path.join(runtime, ...layout.cli), '--acp'],
		{cwd: project, env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true},
	);
	const pending = new Map();
	const text = [];
	let nextId = 0;
	createInterface({input: child.stdout}).on('line', line => {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.method === 'session/update') {
			const update = message.params?.update;
			if (update?.sessionUpdate === 'agent_message_chunk')
				text.push(update.content?.text ?? '');
		} else if (message.method && message.id !== undefined) {
			child.stdin.write(
				`${JSON.stringify({jsonrpc: '2.0', id: message.id, error: {code: -32601, message: 'unsupported'}})}\n`,
			);
		} else if (pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			const timer = setTimeout(
				() => reject(new Error(`${method} timed out`)),
				90_000,
			);
			pending.set(id, message => {
				clearTimeout(timer);
				message.error
					? reject(new Error(`${method}: ${message.error.message}`))
					: resolve(message.result);
			});
			child.stdin.write(
				`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`,
			);
		});
	try {
		const init = await request('initialize', {
			protocolVersion: 1,
			clientCapabilities: {},
			clientInfo: {name: 'smoke', version: '0.0.0'},
		});
		if (init.agentInfo?.version !== pin.version)
			throw new Error(
				`The bundled Nanocoder reports ${init.agentInfo?.version}, not ${pin.version}`,
			);
		const session = await request('session/new', {
			cwd: project,
			mcpServers: [],
		});
		const done = await request('session/prompt', {
			sessionId: session.sessionId,
			prompt: [{type: 'text', text: 'Say the smoke phrase.'}],
		});
		if (done.stopReason !== 'end_turn')
			throw new Error(`The turn ended with ${done.stopReason}`);
		if (!text.join('').includes(REPLY))
			throw new Error('The turn did not return the scripted reply');
	} finally {
		child.stdin.end();
		child.kill();
	}
}

const executable = findExecutable();
if (!existsSync(executable)) {
	console.error(`Packaged app not found: ${executable}`);
	process.exit(1);
}
const resources = resourcesOf(executable);
const work = mkdtempSync(path.join(tmpdir(), 'nd-smoke-'));
const home = path.join(work, 'home');
const project = path.join(work, 'project');
mkdirSync(home);
mkdirSync(project);
const env = bareEnvironment();
const found = nodeOnPath(env);
console.log(
	found
		? `Note: a Node was found on the bare PATH at ${found}; the app is still checked against its own bundle`
		: 'No Node on the bare PATH',
);

let failed;
try {
	console.log(`Launching ${executable}`);
	const resultFile = path.join(work, 'runtime-check.json');
	const launched = spawnSync(
		executable,
		['--smoke-test', `--smoke-result=${resultFile}`],
		{env, stdio: 'inherit', timeout: 120_000},
	);
	if (launched.error || launched.status !== 0) {
		const reported = existsSync(resultFile)
			? readFileSync(resultFile, 'utf8')
			: 'no result';
		throw new Error(
			`The packaged app failed its start-up check: ${launched.error?.message ?? `exit code ${launched.status}`} (${reported})`,
		);
	}
	const check = JSON.parse(readFileSync(resultFile, 'utf8'));
	console.log(`Runtime check: ${JSON.stringify(check)}`);
	if (!check.ok || check.source !== 'bundled')
		throw new Error('The packaged app did not use its bundled runtime');
	if (check.version !== pin.version)
		throw new Error(
			`Bundled Nanocoder is ${check.version}, not ${pin.version}`,
		);
	if (check.nodeVersion !== nodePin.version)
		throw new Error(
			`Bundled Node is ${check.nodeVersion}, not ${nodePin.version}`,
		);

	const provider = await startProvider();
	try {
		const config = path.join(work, 'config');
		mkdirSync(config);
		writeFileSync(
			path.join(config, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					providers: [
						{name: 'Smoke', baseUrl: provider.baseUrl, models: ['smoke-model']},
					],
				},
			}),
		);
		await runTurn(
			resources,
			{
				...env,
				HOME: home,
				USERPROFILE: home,
				NANOCODER_CONFIG_DIR: config,
				NANOCODER_DATA_DIR: path.join(work, 'data'),
				// Only this throwaway project, in this test, is trusted.
				NANOCODER_TRUST_DIRECTORY: '1',
			},
			project,
		);
	} finally {
		await provider.close();
	}
	console.log(
		`Packaged app ran a turn with its own Node ${nodePin.version} and Nanocoder ${pin.version}`,
	);
} catch (error) {
	failed = error;
} finally {
	rmSync(work, {recursive: true, force: true});
}
if (failed) {
	console.error(`Smoke test failed: ${failed.message}`);
	process.exit(1);
}
console.log('Packaged app started, ran its bundled runtime and exited cleanly');
