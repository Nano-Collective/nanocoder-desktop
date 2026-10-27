import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	ConnectFailure,
	type ConnectOptions,
	connectNanocoder,
	nanocoderMessage,
} from '@/main/nanocoder/acp-client';

const fakeNanocoder = path.join(
	import.meta.dirname,
	'fixtures',
	'fake-nanocoder.mjs',
);
const folders: string[] = [];

function folder(mode?: string): string {
	const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-acp-')));
	folders.push(dir);
	if (mode) writeFileSync(path.join(dir, '.fake-nanocoder'), mode);
	return dir;
}

function connect(root: string, options: Partial<ConnectOptions> = {}) {
	return connectNanocoder({
		runtime: {nodePath: process.execPath, cliPath: fakeNanocoder},
		root,
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
		...options,
	});
}

async function failure(root: string, options?: Partial<ConnectOptions>) {
	const error = await connect(root, options).then(
		() => undefined,
		(error: unknown) => error,
	);
	if (!(error instanceof ConnectFailure)) {
		throw new Error(`Expected a ConnectFailure, got ${String(error)}`);
	}
	return error;
}

test.after.always(() => {
	for (const dir of folders) rmSync(dir, {recursive: true, force: true});
});

test('records the protocol version, agent version and capabilities', async t => {
	const root = folder();
	const connection = await connect(root);
	t.deepEqual(connection.agent, {
		root,
		protocolVersion: 1,
		name: 'nanocoder',
		version: '9.9.9',
		capabilities: {
			loadSession: true,
			sessions: {close: true, delete: true, list: true, resume: true},
			prompt: {image: false, audio: false, embeddedContext: false},
			mcp: {http: false, sse: false},
		},
	});
	await connection.close();
	t.deepEqual(await connection.exited, {code: 0, signal: null});
});

test('starts Nanocoder in the project root with read-only capabilities', async t => {
	const connection = await connect(folder('echo'));
	await connection.close();
	const params = JSON.parse(connection.stderr.lines()[0]);
	t.deepEqual(params, {
		protocolVersion: 1,
		clientCapabilities: {
			fs: {readTextFile: true, writeTextFile: false},
			terminal: false,
		},
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
	});
});

test("shows Nanocoder's own message when it refuses the folder", async t => {
	const root = folder('refuse');
	const error = await failure(root, {homeDir: path.dirname(root)});
	t.is(error.code, 'AGENT_UNAVAILABLE');
	t.is(
		error.message,
		`Directory ~${path.sep}${path.basename(root)} is not trusted. Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.`,
	);
});

test('redacts secrets in the message', async t => {
	const error = await failure(folder('leak'));
	t.is(error.message, 'ACP initialization failed: Authorization: [redacted]');
});

test('falls back to the exit code when Nanocoder leaves no message', async t => {
	const error = await failure(folder('crash'));
	t.is(error.message, 'Nanocoder stopped before it was ready (exit code 3)');
});

test('reports a runtime that cannot start', async t => {
	const error = await failure(folder(), {
		runtime: {
			nodePath: path.join(tmpdir(), 'no-such-node'),
			cliPath: fakeNanocoder,
		},
	});
	t.is(error.message, 'Nanocoder could not start');
});

test('ends the connection when stdout carries anything but ACP', async t => {
	const error = await failure(folder('garbage'));
	t.is(
		error.message,
		'Nanocoder wrote something other than ACP to standard output',
	);
});

test('refuses another ACP protocol version', async t => {
	const error = await failure(folder('future'));
	t.is(error.code, 'UNSUPPORTED');
	t.is(
		error.message,
		'Nanocoder uses ACP protocol version 2; this app supports version 1',
	);
});

test('gives up when Nanocoder does not answer', async t => {
	const error = await failure(folder('silent'), {initializeTimeoutMs: 200});
	t.is(error.message, 'Nanocoder did not answer within 0.2 seconds');
});

test("picks Nanocoder's own line out of other stderr output", t => {
	t.is(
		nanocoderMessage([
			'(node:1) Warning: something',
			'[nanocoder] first',
			'[nanocoder] second',
			'    at main (cli.js:1:1)',
		]),
		'second',
	);
	t.is(nanocoderMessage(['plain output']), undefined);
});
