import {client, methods, PROTOCOL_VERSION} from '@agentclientprotocol/sdk';
import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {launchNanocoder, waitForExit} from '@/main/nanocoder/launch';
import {protocolStream} from '@/main/nanocoder/protocol-stream';
import {trustDirectory} from '@/main/nanocoder/trust';

const folder = createWorkFolder('nd-empty-session-');

test.before(requireCli);
test.after.always(folder.remove);

test('pinned Nanocoder cannot resume an empty session after a crash immediately after session/new (upstream limit)', async t => {
	t.timeout(180_000);
	const project = await setupProject(folder.work, 'empty-session', []);
	await trustDirectory({runtime, root: project.root, env: project.env});
	const child = launchNanocoder(runtime, ['--acp'], project.root, project.env);
	const exited = waitForExit(child);
	child.stdin.on('error', () => {});
	child.stderr.resume();
	const first = client({name: clientInfo.name}).connect(
		protocolStream(child.stdout, child.stdin, () => child.kill()),
	);
	try {
		await first.agent.request(methods.agent.initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {},
			clientInfo,
		});
		const created = await first.agent.request(methods.agent.session.new, {
			cwd: project.root,
			mcpServers: [],
		});
		t.truthy(created.sessionId);
		t.true(child.kill('SIGKILL'));
		t.is((await exited).signal, 'SIGKILL');
		first.close();
		const second = await connectNanocoder({
			runtime,
			root: project.root,
			clientInfo,
			env: project.env,
		});
		try {
			const error = await t.throwsAsync(
				second.resumeSession(created.sessionId, 'normal'),
				{instanceOf: NanocoderFailure},
			);
			t.is((error as NanocoderFailure).code, 'NOT_FOUND');
			t.regex(
				(error as NanocoderFailure).message,
				/no longer has this session/,
			);
			t.is(project.provider.requests.length, 0);
		} finally {
			await second.close();
		}
	} finally {
		first.close();
		if (child.exitCode === null && child.signalCode === null)
			child.kill('SIGKILL');
		await exited;
		await project.provider.close();
	}
});
