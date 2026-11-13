import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {createFilesRuntime} from '@/main/files/runtime';
import {connectNanocoder} from '@/main/nanocoder/acp-client';
import {capabilityGates} from '@/main/nanocoder/capabilities';
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
import type {ProjectInfo} from '@/shared/ipc';

// A real Nanocoder against a scripted model: the pre-edit snapshots it keeps
// really show only the agent's lines in a file the user had already edited
// (GIT-09), and the review falls back with a reason when they cannot (GIT-10).
const folder = createWorkFolder('nd-agent-changes-');
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

async function run(
	name: string,
	script: Reply[],
	prepare: (root: string) => void,
) {
	const {root, provider, env} = await setupProject(folder.work, name, script);
	git(root, '-c', 'init.defaultBranch=main', 'init', '-q');
	prepare(root);
	await trustDirectory({runtime, root, env});
	let sequence = 0;
	let tracked: ReturnType<typeof createFilesRuntime> | undefined;
	const connection = await connectNanocoder({
		runtime,
		root,
		clientInfo,
		env,
		onUpdate: update => {
			const event = toTurnEvent(update);
			if (!event) return;
			sequence += 1;
			tracked?.tracker.observe({
				type: 'turn',
				projectId: 'project',
				threadId: 'thread',
				sequence,
				events: [event],
			});
		},
	});
	const probes = await connection.probeExtensions();
	const gates = capabilityGates('test', connection.agent, probes, true);
	const session = await connection.newSession('auto-accept');
	const files = createFilesRuntime({
		projects: () => [projectFor(root)],
		project: () => projectFor(root),
		editor: () => 'system',
		send: () => {},
		openPath: async () => '',
		showItemInFolder: () => {},
		agentChanges: {
			gate: () => ({
				enabled: gates.features.agentChanges.enabled,
				reason: gates.features.agentChanges.reason,
			}),
			snapshots: () => ({
				list: () => connection.listTimeline(session.id),
				read: (checkpointId, file) =>
					connection.readTimeline(session.id, checkpointId, file),
			}),
		},
	});
	tracked = files;
	await files.tracker.begin('project', 'thread');
	const result = await connection.prompt(session.id, 'Edit the files.');
	await files.tracker.end(
		'project',
		'thread',
		result.stopReason === 'end_turn',
	);
	return {
		root,
		files,
		probes,
		gates,
		result,
		async close() {
			files.dispose();
			await connection.close();
			await provider.close();
		},
	};
}

test('GIT-09 the pinned Nanocoder confirms timeline/read and the agent changes show only the agent lines', async t => {
	t.timeout(180_000);
	const outcome = await run(
		'edited',
		[
			{toolCall: {name: 'read_file', arguments: {path: 'notes.txt'}}},
			{
				toolCall: {
					name: 'string_replace',
					arguments: {
						path: 'notes.txt',
						old_str: 'three\n',
						new_str: 'THREE FROM THE AGENT\n',
					},
				},
			},
			{
				toolCall: {
					name: 'write_file',
					arguments: {path: 'fresh.txt', content: 'brand new\n'},
				},
			},
			{text: 'Done.'},
		],
		root => {
			writeFileSync(path.join(root, 'notes.txt'), 'one\ntwo\nthree\n');
			git(root, 'add', '-A');
			git(root, 'commit', '-q', '-m', 'initial');
			writeFileSync(
				path.join(root, 'notes.txt'),
				'ONE FROM THE USER\ntwo\nthree\n',
			);
		},
	);
	try {
		t.is(outcome.result.stopReason, 'end_turn');
		t.true(
			outcome.probes.read,
			'the read method was not confirmed by the probe',
		);
		t.true(outcome.gates.features.agentChanges.enabled);
		t.deepEqual(outcome.files.tracker.latest('project')?.touched.sort(), [
			'fresh.txt',
			'notes.txt',
		]);

		const edited = await outcome.files.review.agentDiff({
			projectId: 'project',
			path: 'notes.txt',
		});
		if (edited.kind !== 'text') return t.fail(JSON.stringify(edited));
		t.true(edited.diff.includes('+THREE FROM THE AGENT'));
		t.true(edited.diff.includes('-three'));
		t.false(
			edited.diff
				.split('\n')
				.some(line => /^[+-]/.test(line) && line.includes('ONE FROM THE USER')),
		);
		t.is(edited.added, 1);
		t.is(edited.removed, 1);

		const all = await outcome.files.review.diff({
			projectId: 'project',
			path: 'notes.txt',
			staged: false,
		});
		t.true(all.kind === 'text' && all.diff.includes('ONE FROM THE USER'));

		const created = await outcome.files.review.agentDiff({
			projectId: 'project',
			path: 'fresh.txt',
		});
		if (created.kind !== 'text') return t.fail(JSON.stringify(created));
		t.is(created.added, 1);
		t.true(created.diff.includes('+brand new'));

		t.is(
			readFileSync(path.join(outcome.root, 'notes.txt'), 'utf8'),
			'ONE FROM THE USER\ntwo\nthree\n'.replace(
				'three',
				'THREE FROM THE AGENT',
			),
		);
	} finally {
		await outcome.close();
	}
});

test('GIT-10 a file the last turn did not edit through a tool call falls back with a reason', async t => {
	t.timeout(180_000);
	const outcome = await run(
		'untouched',
		[
			{
				toolCall: {
					name: 'write_file',
					arguments: {path: 'other.txt', content: 'x\n'},
				},
			},
			{text: 'Done.'},
		],
		root => {
			writeFileSync(path.join(root, 'notes.txt'), 'one\n');
			git(root, 'add', '-A');
			git(root, 'commit', '-q', '-m', 'initial');
		},
	);
	try {
		const answer = await outcome.files.review.agentDiff({
			projectId: 'project',
			path: 'notes.txt',
		});
		t.is(answer.kind, 'fallback');
	} finally {
		await outcome.close();
	}
});

test('GIT-09 an edit Nanocoder refused leaves no net change, so no agent lines are shown', async t => {
	t.timeout(180_000);
	const outcome = await run(
		'refused',
		[
			{
				toolCall: {
					name: 'string_replace',
					arguments: {path: 'notes.txt', old_str: 'one\n', new_str: 'two\n'},
				},
			},
			{text: 'Done.'},
		],
		root => {
			writeFileSync(path.join(root, 'notes.txt'), 'one\n');
			git(root, 'add', '-A');
			git(root, 'commit', '-q', '-m', 'initial');
		},
	);
	try {
		const answer = await outcome.files.review.agentDiff({
			projectId: 'project',
			path: 'notes.txt',
		});
		t.is(answer.kind, 'none');
	} finally {
		await outcome.close();
	}
});
