import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {systemClock} from '@/main/nanocoder/clock';
import {launchNanocoder} from '@/main/nanocoder/launch';
import {openProject} from '@/main/nanocoder/open-project';
import {StderrRing} from '@/main/nanocoder/stderr-ring';
import {type TrustReason, trustDirectory} from '@/main/nanocoder/trust';
import {createTrustPreflight} from '@/main/nanocoder/trust-preflight';

const cli = process.env.NANOCODER_CLI ?? '';
let runtime = {
	nodePath: process.execPath,
	cliPath: cli,
	version: '1.31.0',
	source: 'override' as const,
};
const clientInfo = {name: 'nanocoder-desktop', version: '0.0.0-test'};
const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-acp-real-')),
);
test.before(async () => {
	const start = performance.now();
	const elapsed = () => Math.round(performance.now() - start);
	const timing = {
		deadlineFired: false,
		deadlineFiredMs: null as number | null,
		launchMs: null as number | null,
		spawnMs: null as number | null,
		firstStderrMs: null as number | null,
		exitMs: null as number | null,
		closeMs: null as number | null,
		stdoutBytes: 0,
		exit: null as {code: number | null; signal: NodeJS.Signals | null} | null,
	};
	let stderr: StderrRing | undefined;
	let expected = '';
	try {
		runtime = await createTrustPreflight({
			clock: {
				...systemClock,
				setTimeout: (run, milliseconds) => {
					return systemClock.setTimeout(() => {
						timing.deadlineFired = true;
						timing.deadlineFiredMs = elapsed();
						run();
					}, milliseconds);
				},
			},
			launch: (...args) => {
				timing.launchMs = elapsed();
				const child = launchNanocoder(...args);
				stderr = new StderrRing({homeDir: args[3]?.HOME});
				expected = `[nanocoder] Directory ${args[2]} is not trusted. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.`;
				child.once('spawn', () => {
					timing.spawnMs = elapsed();
				});
				child.stderr.on('data', (chunk: Buffer) => {
					timing.firstStderrMs ??= elapsed();
					stderr?.write(chunk.toString());
				});
				child.stdout.on('data', (chunk: Buffer) => {
					timing.stdoutBytes += chunk.length;
				});
				child.once('exit', (code, signal) => {
					timing.exitMs = elapsed();
					timing.exit = {code, signal};
				});
				child.once('close', () => {
					timing.closeMs = elapsed();
				});
				return child;
			},
		}).verify(runtime, work);
	} catch (error) {
		stderr?.flush();
		console.info('[trust-preflight failure] %j', {
			...timing,
			elapsedMs: elapsed(),
			stderrLines: stderr?.lines().length ?? 0,
			exactRefusal:
				stderr?.lines().length === 1 && stderr.lines()[0] === expected,
		});
		throw error;
	}
});
// Nanocoder keeps its config and trust list here, not in the user's home.
const env = {
	...process.env,
	NANOCODER_CONFIG_DIR: path.join(work, 'config'),
	NANOCODER_DATA_DIR: path.join(work, 'data'),
	// AVA sets NODE_ENV=test, which makes Nanocoder skip its global config.
	NODE_ENV: undefined,
};

function project(name: string): string {
	const dir = path.join(work, name);
	mkdirSync(dir);
	return dir;
}

const connect = (root: string) =>
	connectNanocoder({runtime, root, clientInfo, env});

async function refusal(root: string): Promise<NanocoderFailure> {
	const error = await connect(root).then(
		async connection => {
			await connection.close();
			return undefined;
		},
		(error: unknown) => error,
	);
	if (!(error instanceof NanocoderFailure)) {
		throw new Error(`Nanocoder started in ${root}`);
	}
	return error;
}

test.before(() => {
	if (!path.isAbsolute(cli)) {
		throw new Error('Set NANOCODER_CLI to the absolute path of dist/cli.js');
	}
	mkdirSync(env.NANOCODER_CONFIG_DIR);
	writeFileSync(
		path.join(env.NANOCODER_CONFIG_DIR, 'agents.config.json'),
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
});

test.after.always(() => {
	rmSync(work, {recursive: true, force: true});
});

test("an untrusted folder shows Nanocoder's own refusal", async t => {
	t.timeout(60_000);
	const error = await refusal(project('untrusted'));
	t.is(error.code, 'AGENT_UNAVAILABLE');
	t.regex(error.message, /is not trusted/);
	t.is(error.trust?.reason, 'not-trusted');
});

test('the trust launch trusts the folder, and a session starts in normal mode', async t => {
	t.timeout(120_000);
	const root = project('trusted');
	await trustDirectory({runtime, root, env});

	const connection = await connect(root);
	const session = await connection.newSession('normal');
	await connection.close();
	t.is(connection.agent.root, root);
	t.is(connection.agent.protocolVersion, 1);
	t.is(connection.agent.name, 'nanocoder');
	t.regex(connection.agent.version ?? '', /^\d+\.\d+\.\d+/);
	t.true(connection.agent.capabilities.sessions.resume);
	t.true(connection.agent.capabilities.sessions.close);
	t.is(session.mode, 'normal');
	t.true(session.id.length > 0);
});

test('a changed fingerprint is refused with its reason, then trusted again', async t => {
	t.timeout(180_000);
	const root = project('changed');
	await trustDirectory({runtime, root, env});
	await (await connect(root)).close();

	writeFileSync(path.join(root, '.mcp.json'), '{"mcpServers": {}}\n');
	const error = await refusal(root);
	t.regex(error.message, /changed since you trusted it/);
	t.is(error.trust?.reason, 'changed');

	const asked: TrustReason[] = [];
	const opened = await openProject({
		runtime,
		root,
		clientInfo,
		env,
		mode: 'normal',
		confirmTrust: async ({reason}) => {
			asked.push(reason);
			return true;
		},
	});
	t.deepEqual(asked, ['changed']);
	t.is(opened.status, 'open');
	if (opened.status === 'open') {
		t.is(opened.session.mode, 'normal');
		await opened.connection.close();
	}
});
