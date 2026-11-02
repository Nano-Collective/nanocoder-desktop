import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test, {type ExecutionContext} from 'ava';
import {resolveAttachments} from '@/main/files/attachments';
import {FileService} from '@/main/files/file-service';
import type {ProjectInfo} from '@/shared/ipc';

function fixture(t: ExecutionContext) {
	const base = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-attach-')),
	);
	t.teardown(() => rmSync(base, {recursive: true, force: true}));
	const root = path.join(base, 'project');
	mkdirSync(path.join(root, 'src'), {recursive: true});
	mkdirSync(path.join(root, '.git'));
	mkdirSync(path.join(base, 'outside'));
	writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
	writeFileSync(path.join(root, '.git/config'), 'secret');
	writeFileSync(path.join(base, 'outside/secret.txt'), 'top secret');
	const project: ProjectInfo = {
		id: 'project',
		canonicalRoot: root,
		sessionCwd: root,
		displayName: 'project',
		trusted: true,
		defaultMode: 'normal',
		availability: 'available',
		createdAt: '',
		lastOpenedAt: '',
	};
	const files = new FileService({project: () => project});
	return {base, root, project, files};
}

test('FILE-08 CHAT-16 a file is embedded when the agent accepts embedded context', async t => {
	const f = fixture(t);
	const result = await resolveAttachments(
		f.files,
		f.project,
		[{kind: 'file', path: 'src/a.ts'}],
		true,
	);
	t.deepEqual(result.blocks, [
		{
			type: 'resource',
			resource: {
				uri: pathToFileURL(path.join(f.root, 'src/a.ts')).href,
				mimeType: 'text/plain',
				text: 'export const a = 1;\n',
			},
		},
	]);
	t.deepEqual(result.summary, ['attached: src/a.ts']);
});

test('FILE-08 ACP-11 otherwise the file is linked so Nanocoder reads it through the checked handler', async t => {
	const f = fixture(t);
	const result = await resolveAttachments(
		f.files,
		f.project,
		[{kind: 'file', path: 'src/a.ts'}],
		false,
	);
	t.deepEqual(result.blocks, [
		{
			type: 'resource_link',
			uri: pathToFileURL(path.join(f.root, 'src/a.ts')).href,
			name: 'src/a.ts',
			mimeType: 'text/plain',
			size: 20,
		},
	]);
	t.false(JSON.stringify(result).includes('export const'));
});

test('SEC-03 FILE-08 files outside the project, in .git, binary, oversized or missing are refused', async t => {
	const f = fixture(t);
	writeFileSync(path.join(f.root, 'blob.bin'), Buffer.from([0, 1, 2]));
	writeFileSync(path.join(f.root, 'huge.txt'), 'x'.repeat(1_048_577));
	try {
		symlinkSync(
			path.join(f.base, 'outside'),
			path.join(f.root, 'escape'),
			'junction',
		);
	} catch {
		// Links are skipped where this account cannot create them.
	}
	for (const [attachment, code] of [
		['../outside/secret.txt', 'VALIDATION'],
		['/etc/passwd', 'VALIDATION'],
		['.git/config', 'DENIED'],
		['blob.bin', 'VALIDATION'],
		['huge.txt', 'VALIDATION'],
		['missing.ts', 'NOT_FOUND'],
		['src', 'VALIDATION'],
	] as const)
		await t.throwsAsync(
			resolveAttachments(
				f.files,
				f.project,
				[{kind: 'file', path: attachment}],
				true,
			),
			{code},
			attachment,
		);
	for (const embedded of [true, false]) {
		const error = await t.throwsAsync(
			resolveAttachments(
				f.files,
				f.project,
				[{kind: 'file', path: 'escape/secret.txt'}],
				embedded,
			),
		);
		if (error) t.false(error.message.includes('top secret'));
	}
});

test('SEC-17 an untrusted project resolves no attachment', async t => {
	const f = fixture(t);
	f.project.trusted = false;
	await t.throwsAsync(
		resolveAttachments(
			f.files,
			f.project,
			[{kind: 'file', path: 'src/a.ts'}],
			true,
		),
		{code: 'DENIED'},
	);
});

test('GIT-07 CHAT-16 a review comment becomes quoted text for this prompt only', async t => {
	const f = fixture(t);
	const result = await resolveAttachments(
		f.files,
		f.project,
		[
			{
				kind: 'review-comment',
				path: 'src/a.ts',
				startLine: 4,
				endLine: 6,
				side: 'unstaged',
				comment: 'Why not use a constant here?',
				excerpt: '+const a = 1;\n+const b = 2;\n',
			},
			{
				kind: 'review-comment',
				path: 'src/b.ts',
				startLine: 9,
				endLine: 9,
				side: 'staged',
				comment: 'Rename this.',
				excerpt: '',
			},
		],
		false,
	);
	t.deepEqual(result.blocks, [
		{
			type: 'text',
			text: 'Review comment on src/a.ts, lines 4-6 (unstaged changes):\n> +const a = 1;\n> +const b = 2;\nWhy not use a constant here?',
		},
		{
			type: 'text',
			text: 'Review comment on src/b.ts, line 9 (staged changes):\nRename this.',
		},
	]);
	t.deepEqual(result.summary, [
		'review comment: src/a.ts:4-6',
		'review comment: src/b.ts:9-9',
	]);
});

test('GIT-07 a review comment on an invalid or .git path is refused', async t => {
	const f = fixture(t);
	for (const bad of ['../x', '/abs', '', '.git/config', 'a/.GIT/b']) {
		await t.throwsAsync(
			resolveAttachments(
				f.files,
				f.project,
				[
					{
						kind: 'review-comment',
						path: bad,
						startLine: 1,
						endLine: 1,
						side: 'staged',
						comment: 'x',
						excerpt: '',
					},
				],
				false,
			),
			undefined,
			bad,
		);
	}
});
