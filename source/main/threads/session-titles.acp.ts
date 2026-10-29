import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import type {SessionTitleChange} from '@/main/nanocoder/session-title';
import {trustDirectory} from '@/main/nanocoder/trust';

const folder = createWorkFolder('nd-session-titles-');

test.before(requireCli);
test.after.always(folder.remove);

test('probed Nanocoder rename uses the saved session and reports missing history (CHAT-12)', async t => {
	t.timeout(180_000);
	const project = await setupProject(folder.work, 'rename', [
		{text: 'Fixture response'},
	]);
	await trustDirectory({runtime, root: project.root, env: project.env});
	const connection = await connectNanocoder({
		runtime,
		root: project.root,
		clientInfo,
		env: project.env,
	});
	try {
		const session = await connection.newSession('normal');
		await connection.prompt(
			session.id,
			'fixture prompt long enough to retain its heuristic title',
		);
		const beforeProbe = await t.throwsAsync(
			connection.renameSession(session.id, 'fixture manual title'),
			{instanceOf: NanocoderFailure},
		);
		t.is(beforeProbe?.code, 'UNSUPPORTED');
		t.true((await connection.probeExtensions()).rename);
		t.is(
			await connection.renameSession(session.id, ' fixture manual title '),
			'fixture manual title',
		);
		const missing = await t.throwsAsync(
			connection.renameSession('missing-fixture-session', 'fixture title'),
			{instanceOf: NanocoderFailure},
		);
		t.is(missing?.code, 'NOT_FOUND');
	} finally {
		await connection.close();
		await project.provider.close();
	}
});

test('Nanocoder generated titles arrive through the main-only callback (CHAT-12)', async t => {
	t.timeout(180_000);
	const project = await setupProject(folder.work, 'generated-title', [
		{text: 'Fixture response'},
		{text: 'More fixture response'},
	]);
	await trustDirectory({runtime, root: project.root, env: project.env});
	let receive = (_change: SessionTitleChange) => {};
	const connection = await connectNanocoder({
		runtime,
		root: project.root,
		clientInfo,
		env: project.env,
		onTitleChanged: change => receive(change),
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const title = new Promise<SessionTitleChange>((resolve, reject) => {
			receive = resolve;
			timer = setTimeout(
				() =>
					reject(new Error('Nanocoder title notification was not delivered')),
				10_000,
			);
		});
		const session = await connection.newSession('normal');
		await connection.prompt(session.id, 'hi');
		await connection.prompt(session.id, 'fixture second prompt');
		t.deepEqual(await title, {sessionId: session.id, title: 'ok'});
	} finally {
		clearTimeout(timer);
		await connection.close();
		await project.provider.close();
	}
});
