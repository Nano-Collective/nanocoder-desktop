import test from 'ava';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import {trustDirectory} from '@/main/nanocoder/trust';
import {sessionDiscovery} from '@/main/threads/session-discovery';

const folder = createWorkFolder('nd-real-discovery-');
test.before(requireCli);
test.after.always(folder.remove);

test('ACP-18 real cwd-scoped discovery offers Nanocoder-saved history without prompting and resumes its exact ID with context', async t => {
	t.timeout(180_000);
	const project = await setupProject(folder.work, 'discovery', [
		{text: 'Noted: the fixture word is albatross.'},
		{text: 'The fixture word is albatross.'},
	]);
	const connect = () =>
		connectNanocoder({
			runtime,
			root: project.root,
			clientInfo,
			env: project.env,
		});
	try {
		await trustDirectory({runtime, root: project.root, env: project.env});
		const first = await connect();
		let sessionId: string;
		try {
			const session = await first.newSession('normal');
			sessionId = session.id;
			await first.prompt(sessionId, 'Remember the fixture word albatross.');
		} finally {
			await first.close();
			await first.exited;
		}
		const second = await connect();
		try {
			if (!second.listSessions) throw new Error('Missing listing adapter');
			const turns = () =>
				project.provider.requests.filter(
					request => (request.tools?.length ?? 0) > 0,
				);
			const before = turns().length;
			const offers = await sessionDiscovery(
				await second.listSessions(),
				project.root,
			);
			const offered = offers.find(row => row.session.id === sessionId);
			t.truthy(offered);
			t.is(offered?.reportedCwd, project.root);
			t.is(offered?.session.sessionCwd, project.root);
			t.is(turns().length, before);
			const resumed = await second.resumeSession(sessionId, 'normal');
			t.deepEqual(resumed.session, {id: sessionId, mode: 'normal'});
			t.true(
				resumed.history.some(
					row =>
						row.type === 'user' &&
						row.text === 'Remember the fixture word albatross.',
				),
			);
			t.is(turns().length, before);
			await second.prompt(sessionId, 'What was the fixture word?');
			const messages = turns().at(-1)?.messages;
			t.deepEqual(
				messages?.map(row => row.role),
				['system', 'user', 'assistant', 'user'],
			);
			t.is(messages?.[1].content, 'Remember the fixture word albatross.');
			t.is(messages?.[2].content, 'Noted: the fixture word is albatross.');
			t.is(messages?.[3].content, 'What was the fixture word?');
		} finally {
			await second.close();
			await second.exited;
		}
	} finally {
		await project.provider.close();
	}
});
