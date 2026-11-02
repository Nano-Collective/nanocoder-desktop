import {writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {SCRIPTED_MODEL} from '@/main/nanocoder/fixtures/scripted-provider';
import {trustDirectory} from '@/main/nanocoder/trust';
import type {NanocoderMode} from '@/shared/ipc';

const folder = createWorkFolder('nd-controls-real-');
test.before(requireCli);
test.after.always(folder.remove);

test('pinned ACP offers, provider-confirmed different model and historical resume remain process-current (CHAT-10 ACP-14)', async t => {
	t.timeout(120_000);
	const {root, provider, env} = await setupProject(folder.work, 'config', [
		{text: 'fixture saved history'},
	]);
	t.teardown(() => provider.close());
	writeFileSync(
		path.join(env.NANOCODER_CONFIG_DIR, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				providers: [
					{
						name: 'Scripted',
						baseUrl: provider.baseUrl,
						models: [SCRIPTED_MODEL],
					},
					{
						name: 'Other',
						baseUrl: provider.baseUrl,
						models: ['other-fixture-model'],
					},
				],
			},
		}),
	);
	await trustDirectory({runtime, root, env});
	const connection = await connectNanocoder({runtime, root, env, clientInfo});
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	const initial = connection.getSessionOffers(session.id);
	t.truthy(initial);
	t.deepEqual(initial?.offeredModes, [
		'normal',
		'auto-accept',
		'yolo',
		'plan',
		'architect',
	]);
	t.is(
		initial?.configOptions?.find(option => option.id === 'model')?.currentValue,
		SCRIPTED_MODEL,
	);
	await connection.prompt(session.id, 'save synthetic fixture history');
	const confirmed = await connection.setConfigOption(
		session.id,
		'provider',
		'Other',
	);
	t.is(
		confirmed.configOptions?.find(option => option.id === 'provider')
			?.currentValue,
		'Other',
	);
	t.is(
		confirmed.configOptions?.find(option => option.id === 'model')
			?.currentValue,
		'other-fixture-model',
	);
	await connection.resumeSession(session.id, 'normal');
	t.is(
		connection
			.getSessionOffers(session.id)
			?.configOptions?.find(option => option.id === 'model')?.currentValue,
		'other-fixture-model',
	);
});

test('pinned ACP live mode changes acknowledge before readiness, and unknown modes fail closed (ACP-13 DEC-31)', async t => {
	t.timeout(120_000);
	const {root, provider, env} = await setupProject(folder.work, 'mode', []);
	t.teardown(() => provider.close());
	await trustDirectory({runtime, root, env});
	const connection = await connectNanocoder({runtime, root, env, clientInfo});
	t.teardown(() => connection.close());
	const session = await connection.newSession('normal');
	const changing = connection.setMode(session.id, 'plan');
	t.is(connection.getSessionOffers(session.id), undefined);
	t.deepEqual(await changing, {id: session.id, mode: 'plan'});
	t.truthy(connection.getSessionOffers(session.id));
	await t.throwsAsync(
		connection.setMode(session.id, 'future' as NanocoderMode),
		{instanceOf: NanocoderFailure},
	);
	t.truthy(connection.getSessionOffers(session.id));
	t.deepEqual(await connection.setMode(session.id, 'normal'), {
		id: session.id,
		mode: 'normal',
	});
});
