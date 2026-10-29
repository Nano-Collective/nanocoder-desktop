import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {RequestPermissionRequest} from '@agentclientprotocol/sdk';
import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import type {Reply} from '@/main/nanocoder/fixtures/scripted-provider';
import {trustDirectory} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import type {NanocoderMode, TurnEvent} from '@/shared/ipc';

const folder = createWorkFolder('nd-turn-');
const setup = (name: string, script: Reply[]) =>
	setupProject(folder.work, name, script);

test.before(requireCli);
test.after.always(folder.remove);

const markerCommand = {
	toolCall: {name: 'execute_bash', arguments: {command: 'echo ran>marker.txt'}},
} as const;

async function runTurn(
	name: string,
	script: Reply[],
	answer?: string,
	prepare?: (root: string) => void,
	mode: NanocoderMode = 'normal',
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
		const session = await connection.newSession(mode);
		const result = await connection.prompt(
			session.id,
			'Run the marker command.',
		);
		return {
			result,
			asked,
			events,
			ran: existsSync(path.join(root, 'marker.txt')),
			wrote: existsSync(path.join(root, 'notes.txt')),
			root,
			requests: provider.requests,
		};
	} finally {
		await connection.close();
		await provider.close();
	}
}

// execute_bash asks in every mode, so only a file edit shows which mode a session is in.
const editFile = {
	toolCall: {
		name: 'write_file',
		arguments: {path: 'notes.txt', content: 'hello\n'},
	},
} as const;

test('normal mode asks before editing a file', async t => {
	t.timeout(120_000);
	const outcome = await runTurn(
		'edit-normal',
		[editFile, {text: 'Done.'}],
		'deny',
		undefined,
		'normal',
	);

	t.is(outcome.asked.length, 1);
	t.regex(outcome.asked[0].toolCall.title ?? '', /write_file/);
	t.false(outcome.wrote);
});

test('auto-accept edits a file without asking, which is why the mode is set', async t => {
	t.timeout(120_000);
	const outcome = await runTurn(
		'edit-auto',
		[editFile, {text: 'Done.'}],
		'deny',
		undefined,
		'auto-accept',
	);

	t.deepEqual(outcome.asked, []);
	t.true(outcome.wrote);
});

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
		['commands', 'pending', 'in_progress', 'completed', 'text'],
	);
	t.deepEqual(outcome.events[0], {type: 'commands', commands: []});
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
		['commands', 'pending', 'failed', 'text'],
	);
	t.deepEqual(outcome.events[0], {type: 'commands', commands: []});
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
		['commands', 'pending', 'failed'],
	);
	t.deepEqual(outcome.events[0], {type: 'commands', commands: []});
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
