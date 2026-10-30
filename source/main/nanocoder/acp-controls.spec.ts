import path from 'node:path';
import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import type {NanocoderMode} from '@/shared/ipc';

test.after.always(removeFakeProjects);
function connect(scenario?: string, onUpdate?: () => void) {
	return connectNanocoder({
		root: fakeProject(scenario),
		runtime: {
			nodePath: process.execPath,
			cliPath: path.join(
				import.meta.dirname,
				'fixtures/fake-control-nanocoder.mjs',
			),
		},
		clientInfo: {name: 'fixture', version: '0.0.0'},
		shutdownGraceMs: 20,
		onUpdate,
	});
}

test('ACP retains bounded offers only for safely acknowledged new and resumed sessions (ACP-13 ACP-14)', async t => {
	const connection = await connect();
	t.teardown(() => connection.close());
	t.is(connection.getSessionOffers('missing'), undefined);
	const session = await connection.newSession('normal');
	t.deepEqual(connection.getSessionOffers(session.id)?.offeredModes, [
		'normal',
		'auto-accept',
		'yolo',
		'plan',
		'architect',
	]);
	t.is(
		connection.getSessionOffers(session.id)?.configOptions?.[0]?.currentValue,
		'a',
	);
	await connection.resumeSession(session.id, 'normal');
	t.is(
		connection.getSessionOffers(session.id)?.configOptions?.[1]?.currentValue,
		'old',
	);
});

test('ACP rejects even an advertised unknown initial mode rather than using upstream fallback (ACP-13)', async t => {
	const connection = await connect();
	t.teardown(() => connection.close());
	await t.throwsAsync(connection.newSession('future' as NanocoderMode), {
		instanceOf: NanocoderFailure,
	});
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/set_mode',
		),
	);
});

test('ACP provider acknowledgement replaces the model for all project sessions using one mutation RPC (CHAT-10 ACP-14)', async t => {
	const connection = await connect();
	t.teardown(() => connection.close());
	const one = await connection.newSession('normal');
	const two = await connection.newSession('normal');
	const confirmed = await connection.setConfigOption(one.id, 'provider', 'b');
	t.is(confirmed.configOptions?.[0]?.currentValue, 'b');
	t.is(confirmed.configOptions?.[1]?.currentValue, 'confirmed');
	t.is(
		connection.getSessionOffers(two.id)?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
	t.is(
		fakeEvents(connection.stderr.lines()).filter(
			event => event.method === 'session/set_config_option',
		).length,
		1,
	);
});

test('ACP config failure after partial upstream mutation blocks prompts even after another fresh same-process session (ACP-14)', async t => {
	const connection = await connect('config-fails');
	t.teardown(() => connection.close());
	const one = await connection.newSession('normal');
	await t.throwsAsync(connection.setConfigOption(one.id, 'provider', 'b'));
	const two = await connection.newSession('normal');
	await t.throwsAsync(connection.prompt(one.id, 'fixture'));
	await t.throwsAsync(connection.prompt(two.id, 'fixture'));
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/prompt',
		),
	);
});

test('ACP live mode failures leave the session unable to prompt (DEC-31)', async t => {
	const connection = await connect('live-mode-fails');
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	await t.throwsAsync(connection.setMode(session.id, 'plan'));
	await t.throwsAsync(connection.prompt(session.id, 'fixture'));
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/prompt',
		),
	);
});

test('ACP live mode changes wait for acknowledgement before admitting any prompt (DEC-31)', async t => {
	let waiting!: () => void;
	const observed = new Promise<void>(resolve => {
		waiting = resolve;
	});
	const connection = await connect('live-mode-waits', () => waiting());
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	const changing = connection
		.setMode(session.id, 'plan')
		.catch(() => undefined);
	await observed;
	await t.throwsAsync(connection.prompt(session.id, 'fixture'));
	await connection.close();
	await changing;
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/prompt',
		),
	);
});
