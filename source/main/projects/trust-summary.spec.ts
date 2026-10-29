import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {readTrustSummary} from '@/main/projects/trust-summary';

function fixture(t: ExecutionContext) {
	const root = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-trust-')),
	);
	t.teardown(() => rmSync(root, {recursive: true, force: true}));
	return root;
}

test('an empty folder summary names every execution surface without claiming a sandbox (DEC-30)', async t => {
	const summary = await readTrustSummary(fixture(t));
	t.true(Object.values(summary.counts).every(count => count === 0));
	for (const name of [
		'plugins',
		'hooks',
		'MCP servers',
		'formatters',
		'LSP servers',
		'custom tools',
		'subscribed skills',
		'subscribed agents',
		'subscribed commands',
		'.env',
		'confirmation settings',
		'provider endpoints',
	])
		t.true(summary.details.includes(name), name);
	t.true(summary.details.includes('not a sandbox'));
	t.regex(summary.fingerprint, /^[\da-f]{64}$/);
});

test('config summaries count hooks, tools, relaxed permissions and provider endpoints without exposing values (DEC-30)', async t => {
	const root = fixture(t);
	writeFileSync(
		path.join(root, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				hooks: {
					'session-start': [{command: 'fixture-private-command'}],
					'pre-tool': [{command: 'fixture-private-command'}],
				},
				formatters: [{command: 'fixture-private-command', match: '*.ts'}],
				lspServers: [
					{
						name: 'fixture',
						command: 'fixture-private-command',
						languages: ['ts'],
					},
				],
				alwaysAllow: ['fixture-private-command'],
				defaultMode: 'yolo',
				sandbox: false,
				verify: {trustLevel: 'none'},
				providers: [
					{
						name: 'fixture',
						apiKey: 'fixture-private-secret',
						baseUrl:
							'https://fixture-private-secret@example.invalid/path?token=fixture-private-secret',
					},
				],
			},
		}),
	);
	writeFileSync(
		path.join(root, '.mcp.json'),
		JSON.stringify({
			mcpServers: {
				fixture: {
					command: 'fixture-private-command',
					env: {key: 'fixture-private-secret'},
				},
			},
		}),
	);
	writeFileSync(path.join(root, '.env'), 'fixture-private-secret');
	const summary = await readTrustSummary(root);
	t.is(summary.counts.hooks, 2);
	t.is(summary.counts.formatters, 1);
	t.is(summary.counts.lspServers, 1);
	t.is(summary.counts.permissionSettings, 4);
	t.is(summary.counts.providerEndpoints, 1);
	t.is(summary.counts.mcpServers, 1);
	t.is(summary.counts.envFile, 1);
	t.false(JSON.stringify(summary).includes('fixture-private'));
});

for (const name of ['agents.config.json', '.env', '.nanocoder/plugins']) {
	test(`an escaping ${name} symlink refuses a trust summary (SEC-03)`, async t => {
		const root = fixture(t);
		const outside = fixture(t);
		const target = path.join(outside, 'fixture');
		const directory = name.endsWith('plugins');
		if (directory) {
			mkdirSync(target);
			writeFileSync(path.join(target, 'fixture.mjs'), '');
		} else {
			writeFileSync(target, '{}');
		}
		const link = path.join(root, name);
		mkdirSync(path.dirname(link), {recursive: true});
		symlinkSync(
			target,
			link,
			directory && process.platform === 'win32'
				? 'junction'
				: directory
					? 'dir'
					: 'file',
		);
		const error = await t.throwsAsync(readTrustSummary(root), {
			instanceOf: IpcFailure,
		});
		t.is((error as IpcFailure).code, 'DENIED');
	});
}

test('a dangling trust-config link is not mistaken for an absent config (SEC-03)', async t => {
	const root = fixture(t);
	symlinkSync(path.join(root, 'absent'), path.join(root, 'agents.config.json'));
	const error = await t.throwsAsync(readTrustSummary(root), {
		instanceOf: IpcFailure,
	});
	t.is((error as IpcFailure).code, 'DENIED');
});

for (const kind of ['file', 'entries', 'depth', 'total-bytes'] as const) {
	test(`an excessive ${kind} trust scan is refused rather than called complete (SEC-17)`, async t => {
		const root = fixture(t);
		if (kind === 'file') {
			writeFileSync(
				path.join(root, 'agents.config.json'),
				JSON.stringify({padding: 'x'.repeat(256 * 1024)}),
			);
		} else {
			const directory =
				kind === 'depth'
					? path.join(
							root,
							'.nanocoder/commands',
							...Array.from({length: 10}, (_, index) => `nested-${index}`),
						)
					: path.join(root, '.nanocoder/plugins');
			mkdirSync(directory, {recursive: true});
			const count = kind === 'entries' ? 513 : kind === 'total-bytes' ? 9 : 1;
			for (let index = 0; index < count; index++)
				writeFileSync(
					path.join(
						directory,
						`fixture-${index}${kind === 'depth' ? '.md' : '.mjs'}`,
					),
					kind === 'total-bytes' ? 'x'.repeat(240 * 1024) : '',
				);
		}
		const error = await t.throwsAsync(readTrustSummary(root), {
			instanceOf: IpcFailure,
		});
		t.is((error as IpcFailure).code, 'LIMIT');
	});
}

test('an incomplete Markdown front matter refuses a subscription summary (SEC-17)', async t => {
	const root = fixture(t);
	const directory = path.join(root, '.nanocoder/agents');
	mkdirSync(directory, {recursive: true});
	writeFileSync(
		path.join(directory, 'fixture.md'),
		'---\nsubscribe: [fixture-private-value]\n',
	);
	const error = await t.throwsAsync(readTrustSummary(root), {
		instanceOf: IpcFailure,
	});
	t.is((error as IpcFailure).code, 'DENIED');
});

test('YAML aliases refuse with a fixed message rather than exposing parser input (SEC-07)', async t => {
	const root = fixture(t);
	const directory = path.join(root, '.nanocoder/skills/fixture');
	mkdirSync(directory, {recursive: true});
	writeFileSync(
		path.join(directory, 'skill.yaml'),
		'events: &fixture-private-value [session-start]\nsubscribe: *fixture-private-value\n',
	);
	const error = await t.throwsAsync(readTrustSummary(root), {
		instanceOf: IpcFailure,
	});
	t.false(error?.message.includes('fixture-private-value'));
});

test('a missing project root cannot produce an empty and apparently complete summary (SEC-03)', async t => {
	const error = await t.throwsAsync(
		readTrustSummary(path.join(fixture(t), 'absent')),
		{instanceOf: IpcFailure},
	);
	t.is((error as IpcFailure).code, 'DENIED');
});

test('a non-file .env refuses a trust summary (SEC-17)', async t => {
	const root = fixture(t);
	mkdirSync(path.join(root, '.env'));
	const error = await t.throwsAsync(readTrustSummary(root), {
		instanceOf: IpcFailure,
	});
	t.is((error as IpcFailure).code, 'DENIED');
});

test('top-level provider endpoints are counted and equal-count edits change the summary snapshot (DEC-30)', async t => {
	const root = fixture(t);
	const filename = path.join(root, 'agents.config.json');
	writeFileSync(
		filename,
		JSON.stringify({providers: [{baseUrl: 'https://first.invalid'}]}),
	);
	const first = await readTrustSummary(root);
	writeFileSync(
		filename,
		JSON.stringify({providers: [{baseUrl: 'https://other.invalid'}]}),
	);
	const second = await readTrustSummary(root);
	t.is(second.counts.providerEndpoints, 1);
	t.deepEqual(first.counts, second.counts);
	t.not(first.fingerprint, second.fingerprint);
});

test('the summary inspects plugins, custom tools and subscribed Markdown without importing or executing them (SEC-17)', async t => {
	const root = fixture(t);
	const put = (name: string, body: string) => {
		const filename = path.join(root, '.nanocoder', name);
		mkdirSync(path.dirname(filename), {recursive: true});
		writeFileSync(filename, body);
	};
	const marker = path.join(root, 'must-not-exist');
	put(
		'plugins/example.mjs',
		`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed');`,
	);
	put('plugins/ignored.txt', 'fixture-private-content');
	put('tools/example.md', 'fixture-private-content');
	put('skills/example/skill.yaml', 'subscribe: [session-start]\n');
	put(
		'skills/example/member.md',
		'---\nsubscribe: [session-start]\n---\nfixture-private-content',
	);
	put('skills/example/tools/command.md', 'fixture-private-content');
	put(
		'agents/example.md',
		'---\nsubscribe: [session-start]\n---\nfixture-private-content',
	);
	put(
		'commands/nested/example.md',
		'---\nsubscribe: [session-start]\n---\nfixture-private-content',
	);
	const summary = await readTrustSummary(root);
	t.is(summary.counts.plugins, 1);
	t.is(summary.counts.customTools, 2);
	t.is(summary.counts.subscribedSkills, 1);
	t.is(summary.counts.subscribedAgents, 1);
	t.is(summary.counts.subscribedCommands, 1);
	t.false(existsSync(marker));
	t.false(JSON.stringify(summary).includes('fixture-private'));
});
