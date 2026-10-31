import {writeFileSync} from 'node:fs';
import path from 'node:path';
import type {SessionNotification} from '@agentclientprotocol/sdk';
import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import type {NanocoderMode} from '@/shared/ipc';

test.after.always(removeFakeProjects);
function connect(
	scenario?: string,
	onUpdate?: (update: SessionNotification['update']) => void,
) {
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

test('ACP current config notification refreshes main-owned offers before display callbacks (ACP-14)', async t => {
	let seen: string | undefined;
	const connection = await connect('config-notify-valid', () => {
		seen =
			connection.getSessionOffers('session-1')?.configOptions?.[1]
				?.currentValue;
	});
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	await connection.prompt(session.id, 'fixture config notification');
	t.is(seen, 'confirmed');
	t.is(
		connection.getSessionOffers(session.id)?.configOptions?.[1]?.currentValue,
		'confirmed',
	);
});

for (const kind of [
	'malformed',
	'malformed-mixed',
	'empty',
	'foreign',
	'old',
]) {
	test(`ACP ${kind} session config notification cannot replace current offers (ACP-14)`, async t => {
		const connection = await connect(`config-notify-${kind}`);
		t.teardown(() => connection.close());
		const one = await connection.newSession('normal');
		const current =
			kind === 'old' ? await connection.newSession('normal') : one;
		const updates: string[] = [];
		connection.observeConfigOptions?.({
			isCurrentSession: sessionId => sessionId === current.id,
			onChange: sessionId => updates.push(sessionId),
		});
		const before = connection.getSessionOffers(current.id);
		await connection.prompt(current.id, 'fixture refused notification');
		t.deepEqual(connection.getSessionOffers(current.id), before);
		t.deepEqual(updates, []);
	});
}

test('ACP closing notifications cannot publish a config change or restore offers (ACP-14)', async t => {
	let seen = 0;
	const connection = await connect('config-notify-close', update => {
		if (update.sessionUpdate === 'config_option_update') seen++;
	});
	const session = await connection.newSession('normal');
	const updates: string[] = [];
	connection.observeConfigOptions?.({
		isCurrentSession: sessionId => sessionId === session.id,
		onChange: sessionId => updates.push(sessionId),
	});
	await connection.close();
	t.deepEqual(updates, []);
	t.is(connection.getSessionOffers(session.id), undefined);
	t.is(seen, 1);
});

test('SDK-stripped malformed config is displayed as an empty list but never clears authoritative offers (ACP-14)', async t => {
	let displayed: unknown;
	const connection = await connect('config-notify-malformed', update => {
		if (update.sessionUpdate === 'config_option_update')
			displayed = update.configOptions;
	});
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	const before = connection.getSessionOffers(session.id);
	await connection.prompt(session.id, 'fixture malformed config');
	t.deepEqual(displayed, []);
	t.deepEqual(connection.getSessionOffers(session.id), before);
});

test('ACP unsolicited config notification cannot clear same-process uncertainty after a failed change (ACP-14)', async t => {
	let notify!: () => void;
	const notified = new Promise<void>(resolve => {
		notify = resolve;
	});
	const connection = await connect('config-fails', update => {
		if (update.sessionUpdate === 'config_option_update') notify();
	});
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	await t.throwsAsync(connection.setConfigOption(session.id, 'provider', 'b'));
	writeFileSync(
		path.join(connection.agent.root, '.fake-control-notification'),
		'fixture',
	);
	await notified;
	t.is(connection.getSessionOffers(session.id)?.configOptions, undefined);
	await t.throwsAsync(
		connection.prompt(session.id, 'fixture must stay blocked'),
		{code: 'AGENT_UNAVAILABLE'},
	);
	t.false(
		fakeEvents(connection.stderr.lines()).some(
			event => event.method === 'session/prompt',
		),
	);
});

test('ACP replayed config remains display-only and cannot publish authoritative offers (ACP-14)', async t => {
	const connection = await connect('config-notify-replay');
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	const before = connection.getSessionOffers(session.id);
	const updates: string[] = [];
	connection.observeConfigOptions?.({
		isCurrentSession: sessionId => sessionId === session.id,
		onChange: sessionId => updates.push(sessionId),
	});
	const resumed = await connection.resumeSession(session.id, 'normal');
	t.deepEqual(updates, []);
	t.deepEqual(connection.getSessionOffers(session.id), before);
	t.true(resumed.history.some(event => event.type === 'config'));
});
