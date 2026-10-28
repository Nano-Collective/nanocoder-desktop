import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {RequestPermissionRequest} from '@agentclientprotocol/sdk';
import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	type Reply,
	SCRIPTED_MODEL,
	startScriptedProvider,
} from '@/main/nanocoder/fixtures/scripted-provider';
import {trustDirectory} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import type {TurnEvent} from '@/shared/ipc';

const cli = process.env.NANOCODER_CLI ?? '';
const runtime = {nodePath: process.execPath, cliPath: cli};
const clientInfo = {name: 'nanocoder-desktop', version: '0.0.0-test'};
const work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-turn-')));

test.before(() => {
	if (!path.isAbsolute(cli)) {
		throw new Error('Set NANOCODER_CLI to the absolute path of dist/cli.js');
	}
});

test.after.always(() => {
	rmSync(work, {recursive: true, force: true});
});

async function setup(name: string, script: Reply[]) {
	const dir = path.join(work, name);
	const root = path.join(dir, 'project');
	mkdirSync(root, {recursive: true});
	const provider = await startScriptedProvider(script);
	const configDir = path.join(dir, 'config');
	mkdirSync(configDir);
	writeFileSync(
		path.join(configDir, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				providers: [
					{
						name: 'Scripted',
						baseUrl: provider.baseUrl,
						models: [SCRIPTED_MODEL],
					},
				],
			},
		}),
	);
	const env = {
		...process.env,
		NANOCODER_CONFIG_DIR: configDir,
		NANOCODER_DATA_DIR: path.join(dir, 'data'),
		// AVA sets NODE_ENV=test, which makes Nanocoder skip its global config.
		NODE_ENV: undefined,
	};
	return {root, provider, env};
}

const markerCommand = {
	toolCall: {name: 'execute_bash', arguments: {command: 'echo ran>marker.txt'}},
} as const;

async function runTurn(
	name: string,
	script: Reply[],
	answer?: string,
	prepare?: (root: string) => void,
) {
	const {root, provider, env} = await setup(name, script);
	prepare?.(root);
	await trustDirectory({runtime, root, env});
	const events: TurnEvent[] = [];
	const asked: RequestPermissionRequest[] = [];
	const connection = await connectNanocoder({
		runtime,
		root,
		clientInfo,
		env,
		onUpdate: update => {
			const event = toTurnEvent(update);
			if (event) events.push(event);
		},
		onPermission: answer
			? async request => {
					asked.push(request);
					return {outcome: {outcome: 'selected', optionId: answer}};
				}
			: undefined,
	});
	try {
		const session = await connection.newSession('normal');
		const result = await connection.prompt(
			session.id,
			'Run the marker command.',
		);
		return {
			result,
			asked,
			events,
			ran: existsSync(path.join(root, 'marker.txt')),
			root,
			requests: provider.requests,
		};
	} finally {
		await connection.close();
		await provider.close();
	}
}

test('allow once: the tool runs and the turn ends', async t => {
	t.timeout(120_000);
	const outcome = await runTurn(
		'allow',
		[markerCommand, {text: 'All done.'}],
		'allow',
	);

	t.is(outcome.asked.length, 1);
	const [request] = outcome.asked;
	t.is(request.toolCall.title, 'execute_bash: echo ran>marker.txt');
	t.deepEqual(request.options, [
		{optionId: 'allow', name: 'Allow', kind: 'allow_once'},
		{optionId: 'deny', name: 'Deny', kind: 'reject_once'},
	]);
	t.true(outcome.ran);
	t.deepEqual(outcome.result, {stopReason: 'end_turn'});
	t.deepEqual(
		outcome.events.map(event =>
			event.type === 'tool' ? event.status : event.type,
		),
		['pending', 'in_progress', 'completed', 'text'],
	);
	t.deepEqual(outcome.events.at(-1), {type: 'text', text: 'All done.'});
});

test('reject once: the tool does not run and the turn goes on', async t => {
	t.timeout(120_000);
	const outcome = await runTurn(
		'reject',
		[markerCommand, {text: 'Understood.'}],
		'deny',
	);

	t.is(outcome.asked.length, 1);
	t.false(outcome.ran);
	t.deepEqual(outcome.result, {stopReason: 'end_turn'});
	t.deepEqual(
		outcome.events.map(event =>
			event.type === 'tool' ? event.status : event.type,
		),
		['pending', 'failed', 'text'],
	);
	t.is(
		outcome.requests.at(1)?.messages.at(-1)?.content,
		'Tool call denied by user',
	);
});

test('with no handler, nothing is allowed by default', async t => {
	t.timeout(120_000);
	const outcome = await runTurn('default', [markerCommand, {text: 'Stopped.'}]);

	t.false(outcome.ran);
	// A cancelled answer ends the turn: Nanocoder does not offer the model a second try.
	t.deepEqual(outcome.result, {stopReason: 'cancelled'});
	t.deepEqual(
		outcome.events.map(event =>
			event.type === 'tool' ? event.status : event.type,
		),
		['pending', 'failed'],
	);
});

test('plugins load for a session at the project root', async t => {
	t.timeout(120_000);
	const outcome = await runTurn(
		'plugins',
		[{text: 'Hello.'}],
		undefined,
		root => {
			const dir = path.join(root, '.nanocoder', 'plugins');
			mkdirSync(dir, {recursive: true});
			// Runs on import, so the marker appears in the folder Nanocoder was started in.
			writeFileSync(
				path.join(dir, 'probe.mjs'),
				"import {writeFileSync} from 'node:fs';\nwriteFileSync(new URL('../../plugin-loaded.txt', import.meta.url), 'loaded');\nexport default {name: 'probe'};\n",
			);
		},
	);

	t.true(existsSync(path.join(outcome.root, 'plugin-loaded.txt')));
});
