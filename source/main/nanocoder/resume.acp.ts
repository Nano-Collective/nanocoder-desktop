import {existsSync} from 'node:fs';
import path from 'node:path';
import type {RequestPermissionRequest} from '@agentclientprotocol/sdk';
import test from 'ava';
import {connectNanocoder, NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	clientInfo,
	createWorkFolder,
	requireCli,
	runtime,
	setupProject,
} from '@/main/nanocoder/fixtures/real-nanocoder';
import type {Reply} from '@/main/nanocoder/fixtures/scripted-provider';
import {trustDirectory} from '@/main/nanocoder/trust';
import type {TurnEvent} from '@/shared/ipc';

const folder = createWorkFolder('nd-resume-');

test.before(requireCli);
test.after.always(folder.remove);

type Env = Awaited<ReturnType<typeof setupProject>>['env'];

// Each call is a fresh Nanocoder process, as after the desktop and Nanocoder both restart.
const start = (
	root: string,
	env: Env,
	answer?: (request: RequestPermissionRequest) => string,
) =>
	connectNanocoder({
		runtime,
		root,
		clientInfo,
		env,
		onPermission: answer
			? async request => ({
					outcome: {outcome: 'selected', optionId: answer(request)},
				})
			: undefined,
	});

async function rememberCodeWord(script: Reply[], name: string) {
	const project = await setupProject(folder.work, name, script);
	await trustDirectory({runtime, root: project.root, env: project.env});
	const first = await start(project.root, project.env);
	const session = await first.newSession('normal');
	await first.prompt(session.id, 'Remember the code word pelican.');
	await first.close();
	await first.exited;
	return {...project, sessionId: session.id};
}

async function failure(promise: Promise<unknown>) {
	const error = await promise.then(
		() => undefined,
		(error: unknown) => error,
	);
	if (!(error instanceof NanocoderFailure)) {
		throw new Error(`Expected a NanocoderFailure, got ${String(error)}`);
	}
	return error;
}

test('after both processes restart, a follow-up is answered with the earlier context', async t => {
	t.timeout(180_000);
	const project = await rememberCodeWord(
		[
			{text: 'Noted: the code word is pelican.'},
			{text: 'The code word is pelican.'},
		],
		'follow-up',
	);
	const live: TurnEvent[] = [];
	const second = await connectNanocoder({
		runtime,
		root: project.root,
		clientInfo,
		env: project.env,
		onUpdate: () => live.push({type: 'text', text: 'unexpected'}),
	});
	try {
		const {session, history} = await second.resumeSession(
			project.sessionId,
			'normal',
		);
		t.deepEqual(session, {id: project.sessionId, mode: 'normal'});
		t.deepEqual(history, [
			{type: 'user', text: 'Remember the code word pelican.'},
			{type: 'text', text: 'Noted: the code word is pelican.'},
		]);
		t.deepEqual(live, []);

		await second.prompt(session.id, 'What was the code word?');
		const turn = project.provider.requests
			.filter(request => (request.tools?.length ?? 0) > 0)
			.at(-1);
		t.deepEqual(
			turn?.messages.map(message => message.role),
			['system', 'user', 'assistant', 'user'],
		);
		t.regex(String(turn?.messages[1].content), /pelican/);
		t.regex(String(turn?.messages[2].content), /pelican/);
		t.is(turn?.messages[3].content, 'What was the code word?');
	} finally {
		await second.close();
		await project.provider.close();
	}
});

test('a deleted or unknown session fails cleanly and leaves Nanocoder usable', async t => {
	t.timeout(180_000);
	const project = await rememberCodeWord(
		[{text: 'Noted: the code word is pelican.'}],
		'deleted',
	);
	const missing =
		"Nanocoder no longer has this session. It was deleted, or removed by Nanocoder's retention settings.";
	try {
		const second = await start(project.root, project.env);
		await second.resumeSession(project.sessionId, 'normal');
		await second.deleteSession(project.sessionId);
		await second.close();

		const third = await start(project.root, project.env);
		const deleted = await failure(
			third.resumeSession(project.sessionId, 'normal'),
		);
		const unknown = await failure(
			third.resumeSession('no-such-session', 'normal'),
		);
		t.deepEqual([deleted.code, deleted.message], ['NOT_FOUND', missing]);
		t.deepEqual([unknown.code, unknown.message], ['NOT_FOUND', missing]);

		const fresh = await third.newSession('normal');
		t.is(fresh.mode, 'normal');
		await third.close();
	} finally {
		await project.provider.close();
	}
});

test('a resumed session is back in the mode the desktop sets, not in auto-accept', async t => {
	t.timeout(240_000);
	const editFile: Reply = {
		toolCall: {
			name: 'write_file',
			arguments: {path: 'notes.txt', content: 'hello\n'},
		},
	};
	const project = await rememberCodeWord(
		[
			{text: 'Noted: the code word is pelican.'},
			editFile,
			{text: 'Done.'},
			editFile,
			{text: 'Done again.'},
		],
		'mode',
	);
	const notes = path.join(project.root, 'notes.txt');
	try {
		// Resumed into normal: the file edit asks, and a refusal leaves the file alone.
		const asked: string[] = [];
		const normal = await start(project.root, project.env, request => {
			asked.push(request.toolCall.title ?? '');
			return 'deny';
		});
		await normal.resumeSession(project.sessionId, 'normal');
		await normal.prompt(project.sessionId, 'Write the notes.');
		await normal.close();
		t.is(asked.length, 1);
		t.regex(asked[0], /write_file/);
		t.false(existsSync(notes));

		// Control: resumed into auto-accept, the same edit runs without a question.
		const auto = await start(project.root, project.env, () => 'deny');
		await auto.resumeSession(project.sessionId, 'auto-accept');
		await auto.prompt(project.sessionId, 'Write the notes.');
		await auto.close();
		t.true(existsSync(notes));
	} finally {
		await project.provider.close();
	}
});
