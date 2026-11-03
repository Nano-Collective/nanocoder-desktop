import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ContentBlock} from '@agentclientprotocol/sdk';
import test from 'ava';
import {readTextForAgent} from '@/main/files/acp-fs';
import {resolveAttachments} from '@/main/files/attachments';
import {createFilesRuntime} from '@/main/files/runtime';
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
import type {ProjectInfo, TurnEvent} from '@/shared/ipc';

// A real Nanocoder against a scripted model, as the *.acp.ts tests do. These
// close two gaps the fake agent cannot: how Nanocoder treats attached files
// (FILE-08, ACP-11, SEC-20) and how its autoCommit shows in the review (GIT-12).
const folder = createWorkFolder('nd-files-');
test.before(requireCli);
test.after.always(folder.remove);

const projectFor = (root: string): ProjectInfo => ({
	id: 'project',
	canonicalRoot: root,
	sessionCwd: root,
	displayName: 'project',
	trusted: true,
	defaultMode: 'normal',
	availability: 'available',
	createdAt: '',
	lastOpenedAt: '',
});

const filesFor = (root: string) =>
	createFilesRuntime({
		projects: () => [projectFor(root)],
		project: () => projectFor(root),
		editor: () => 'system',
		send: () => {},
		openPath: async () => '',
		showItemInFolder: () => {},
	});

const git = (root: string, ...args: string[]) =>
	execFileSync('git', args, {
		cwd: root,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
		},
	});

// Everything the model was sent, as one string, so a test can look for text.
const seenByModel = (
	requests: Array<{messages: Array<{role: string; content?: unknown}>}>,
) => JSON.stringify(requests.map(request => request.messages));

async function turn(
	name: string,
	script: Reply[],
	options: {
		prepare?: (root: string, configFile: string) => void;
		blocks?: (root: string) => Promise<ContentBlock[]> | ContentBlock[];
		text?: string;
		mode?: 'normal' | 'auto-accept';
		onUpdate?: (event: TurnEvent) => void;
		before?: () => Promise<void>;
		after?: (succeeded: boolean) => Promise<void>;
	} = {},
) {
	const {root, provider, env} = await setupProject(folder.work, name, script);
	options.prepare?.(
		root,
		path.join(String(env.NANOCODER_CONFIG_DIR), 'agents.config.json'),
	);
	await trustDirectory({runtime, root, env});
	const connection = await connectNanocoder({
		runtime,
		root,
		clientInfo,
		env,
		onUpdate: update => {
			const event = toTurnEvent(update);
			if (event) options.onUpdate?.(event);
		},
	});
	try {
		const session = await connection.newSession(options.mode ?? 'normal');
		const blocks = await options.blocks?.(root);
		await options.before?.();
		let succeeded = false;
		const result = await connection
			.prompt(session.id, options.text ?? 'Use the attached file.', blocks)
			.then(value => {
				succeeded = value.stopReason === 'end_turn';
				return value;
			})
			.finally(() => options.after?.(succeeded));
		return {
			root,
			result,
			requests: provider.requests,
			embeddedContext: connection.agent.capabilities.prompt.embeddedContext,
		};
	} finally {
		await connection.close();
		await provider.close();
	}
}

const secret = 'LINKED-FILE-CONTENT-7f3a';

test('FILE-08 ACP-11 a linked file is read back through the checked handler and reaches the model', async t => {
	t.timeout(120_000);
	const outcome = await turn('linked', [{text: 'Read it.'}], {
		prepare: root => {
			mkdirSync(path.join(root, 'src'));
			// UTF-16 on disk: only the desktop's checked read decodes it, whereas
			// Nanocoder's own fallback read would show garbled text.
			writeFileSync(
				path.join(root, 'src/notes.txt'),
				Buffer.concat([
					Buffer.from([0xff, 0xfe]),
					Buffer.from(`${secret}\n`, 'utf16le'),
				]),
			);
		},
		blocks: async root => {
			const files = filesFor(root);
			try {
				const resolved = await resolveAttachments(
					files.files,
					projectFor(root),
					[{kind: 'file', path: 'src/notes.txt'}],
					false,
				);
				t.is(resolved.blocks[0].type, 'resource_link');
				return resolved.blocks;
			} finally {
				files.dispose();
			}
		},
	});
	t.is(outcome.result.stopReason, 'end_turn');
	t.true(seenByModel(outcome.requests).includes(secret));
});

test('FILE-08 an embedded file reaches the model without a read back', async t => {
	t.timeout(120_000);
	const outcome = await turn('embedded', [{text: 'Read it.'}], {
		prepare: root => writeFileSync(path.join(root, 'notes.txt'), `${secret}\n`),
		blocks: root => [
			{
				type: 'resource',
				resource: {
					uri: pathToFileURL(path.join(root, 'notes.txt')).href,
					mimeType: 'text/plain',
					text: `${secret}\n`,
				},
			},
		],
	});
	t.is(outcome.result.stopReason, 'end_turn');
	t.true(seenByModel(outcome.requests).includes(secret));
});

test('SEC-20 the desktop refuses to read outside the project, but Nanocoder then reads a linked file itself', async t => {
	t.timeout(120_000);
	const outside = path.join(folder.work, 'outside-secret.txt');
	writeFileSync(outside, 'OUTSIDE-SECRET-91bd\n');
	let root = '';
	const outcome = await turn('outside', [{text: 'Done.'}], {
		prepare: project => {
			root = project;
		},
		blocks: () => [
			{
				type: 'resource_link',
				uri: pathToFileURL(outside).href,
				name: 'outside-secret.txt',
				mimeType: 'text/plain',
			},
		],
	});
	t.is(outcome.result.stopReason, 'end_turn');
	// The desktop's own answer is refused...
	await t.throwsAsync(() => readTextForAgent(root, {path: outside}));
	// ...but a pinned Nanocoder falls back to reading the linked file from disk
	// after a refused client read. SEC-20 bounds the desktop's answer, not the
	// agent, which is why attachments are only ever built from checked files and
	// never from a path the page chose (resolveAttachments).
	t.true(seenByModel(outcome.requests).includes('OUTSIDE-SECRET-91bd'));
});

test('CHAT-16 GIT-07 a review comment block reaches the model as text', async t => {
	t.timeout(120_000);
	const outcome = await turn('comment', [{text: 'Noted.'}], {
		blocks: () => [
			{
				type: 'text',
				text: 'Review comment on src/a.ts, line 3 (unstaged changes):\n> const a = 1;\nREVIEW-COMMENT-3c5e',
			},
		],
	});
	t.is(outcome.result.stopReason, 'end_turn');
	t.true(seenByModel(outcome.requests).includes('REVIEW-COMMENT-3c5e'));
});

test('GIT-12 with autoCommit on, the commit Nanocoder makes during the turn is listed by the review', async t => {
	t.timeout(120_000);
	let files: ReturnType<typeof filesFor> | undefined;
	let headBefore = '';
	let sequence = 0;
	try {
		const outcome = await turn(
			'auto-commit',
			[
				{
					toolCall: {
						name: 'write_file',
						arguments: {path: 'notes.txt', content: 'hello\n'},
					},
				},
				{text: 'Done.'},
			],
			{
				mode: 'auto-accept',
				text: 'Write notes.txt.',
				prepare: (root, configFile) => {
					const config = JSON.parse(readFileSync(configFile, 'utf8'));
					config.nanocoder.autoCommit = true;
					writeFileSync(configFile, JSON.stringify(config));
					git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
					// Nanocoder's own commit needs an identity in the repository, as CI has none.
					git(root, 'config', 'user.name', 'Test');
					git(root, 'config', 'user.email', 'test@example.com');
					writeFileSync(path.join(root, 'README.md'), '# demo\n');
					git(root, 'add', '-A');
					git(root, 'commit', '-q', '-m', 'initial');
					headBefore = git(root, 'rev-parse', 'HEAD').trim();
					files = filesFor(root);
				},
				// The same bracket the desktop puts around a prompt.
				before: async () => {
					await files?.tracker.begin('project', 'thread');
				},
				onUpdate: event => {
					sequence += 1;
					files?.tracker.observe({
						type: 'turn',
						projectId: 'project',
						threadId: 'thread',
						sequence,
						events: [event],
					});
				},
				after: async succeeded => {
					await files?.tracker.end('project', 'thread', succeeded);
				},
			},
		);
		t.is(outcome.result.stopReason, 'end_turn');
		const review = files?.tracker.latest('project');
		t.is(review?.running, false);
		t.is(review?.headBefore, headBefore);
		t.is(review?.headAfter, git(outcome.root, 'rev-parse', 'HEAD').trim());
		t.not(review?.headAfter, headBefore, 'Nanocoder committed during the turn');
		t.true((review?.commits.length ?? 0) >= 1);
		t.deepEqual(review?.touched, ['notes.txt']);
		t.is(readFileSync(path.join(outcome.root, 'notes.txt'), 'utf8'), 'hello\n');
	} finally {
		files?.dispose();
	}
});
