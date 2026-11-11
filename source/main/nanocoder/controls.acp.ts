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

test('pinned ACP offers and a provider-confirmed different model, and resume restores the model saved with the session (CHAT-10 ACP-14)', async t => {
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
	// Model state is per session (nanocoder#1919): resume restores what was saved, not the process's last choice.
	t.is(
		connection
			.getSessionOffers(session.id)
			?.configOptions?.find(option => option.id === 'model')?.currentValue,
		SCRIPTED_MODEL,
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

test('a model change reaches one session when Nanocoder advertises per-session model state, and every session in the process when it does not (ACP-14 CHAT-10)', async t => {
	t.timeout(120_000);
	const {root, provider, env} = await setupProject(folder.work, 'scope', [
		{text: 'first'},
		{text: 'second'},
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
	const first = await connection.newSession('normal');
	const second = await connection.newSession('normal');
	const model = (id: string) =>
		connection
			.getSessionOffers(id)
			?.configOptions?.find(option => option.id === 'model')?.currentValue;
	await connection.setConfigOption(first.id, 'provider', 'Other');
	t.is(model(first.id), 'other-fixture-model');
	const advertised = connection.agent.capabilities.perSessionModel;
	t.log(JSON.stringify({version: connection.agent.version, advertised}));
	const askedModel = async (id: string) => {
		await connection.prompt(id, 'which model');
		return provider.requests.filter(r => r.tools?.length).at(-1)?.model;
	};
	t.is(await askedModel(first.id), 'other-fixture-model');
	t.is(
		await askedModel(second.id),
		advertised ? SCRIPTED_MODEL : 'other-fixture-model',
	);
	t.is(model(second.id), advertised ? SCRIPTED_MODEL : 'other-fixture-model');
});
