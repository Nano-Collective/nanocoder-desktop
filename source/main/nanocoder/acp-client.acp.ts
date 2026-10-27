import {spawnSync} from 'node:child_process';
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
import {ConnectFailure, connectNanocoder} from '@/main/nanocoder/acp-client';

const cli = process.env.NANOCODER_CLI ?? '';
const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-acp-real-')),
);
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

function connect(root: string) {
	return connectNanocoder({
		runtime: {nodePath: process.execPath, cliPath: cli},
		root,
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
		env,
	});
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
	const error = await connect(project('untrusted')).then(
		async connection => {
			await connection.close();
			return undefined;
		},
		(error: unknown) => error,
	);
	if (!(error instanceof ConnectFailure)) {
		t.fail('Nanocoder started in an untrusted folder');
		return;
	}
	t.is(error.code, 'AGENT_UNAVAILABLE');
	t.regex(error.message, /is not trusted/);
});

test('a trusted folder records the version and capabilities', async t => {
	t.timeout(60_000);
	const root = project('trusted');
	spawnSync(process.execPath, [cli, '--acp'], {
		cwd: root,
		env: {...env, NANOCODER_TRUST_DIRECTORY: '1'},
		input: '',
		timeout: 60_000,
	});

	const connection = await connect(root);
	await connection.close();
	t.is(connection.agent.root, root);
	t.is(connection.agent.protocolVersion, 1);
	t.is(connection.agent.name, 'nanocoder');
	t.regex(connection.agent.version ?? '', /^\d+\.\d+\.\d+/);
	t.true(connection.agent.capabilities.sessions.resume);
	t.true(connection.agent.capabilities.sessions.close);
});
