import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {trustDirectory} from '@/main/nanocoder/trust';

const folder = createWorkFolder('nd-session-pins-');

test.before(requireCli);
test.after.always(folder.remove);

test('the pin extension is confirmed by its probe, refuses a session Nanocoder has not saved yet, and pins and unpins a saved one (CHAT-23 DEC-45)', async t => {
	t.timeout(180_000);
	const project = await setupProject(folder.work, 'pin', [{text: 'a reply'}]);
	t.teardown(() => project.provider.close());
	await trustDirectory({runtime, root: project.root, env: project.env});
	const connection = await connectNanocoder({
		runtime,
		root: project.root,
		clientInfo,
		env: project.env,
	});
	try {
		const before = await t.throwsAsync(
			connection.pinSession('anything', true),
			{instanceOf: NanocoderFailure},
		);
		t.is(before?.code, 'UNSUPPORTED');
		t.true((await connection.probeExtensions()).pin);
		const session = await connection.newSession('normal');
		const unsaved = await t.throwsAsync(
			connection.pinSession(session.id, true),
			{instanceOf: NanocoderFailure},
		);
		t.is(unsaved?.code, 'NOT_FOUND');
		await connection.prompt(session.id, 'save this session');
		await connection.pinSession(session.id, true);
		await connection.pinSession(session.id, false);
		await connection.pinSession(session.id, true);
		const gone = await t.throwsAsync(
			connection.pinSession('no-such-session', true),
			{instanceOf: NanocoderFailure},
		);
		t.is(gone?.code, 'NOT_FOUND');
	} finally {
		await connection.close();
	}
});

test('Nanocoder reports the limits of its session store on initialize, and the desktop reads them (DEC-45)', async t => {
	t.timeout(180_000);
	const project = await setupProject(folder.work, 'limits', []);
	t.teardown(() => project.provider.close());
	await trustDirectory({runtime, root: project.root, env: project.env});
	const connection = await connectNanocoder({
		runtime,
		root: project.root,
		clientInfo,
		env: project.env,
	});
	try {
		t.deepEqual(connection.agent.capabilities.retention, {
			days: 30,
			maxSessions: 100,
		});
	} finally {
		await connection.close();
	}
});
