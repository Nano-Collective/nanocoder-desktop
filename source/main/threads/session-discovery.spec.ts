import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {sessionDiscovery} from '@/main/threads/session-discovery';

const timestamp = '2026-10-29T12:00:00.000Z';

function fixture(t: ExecutionContext) {
	const base = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-discovery-')),
	);
	t.teardown(() => rmSync(base, {recursive: true, force: true}));
	const root = path.join(base, 'project');
	const foreign = path.join(base, 'other-project');
	const nested = path.join(root, 'nested');
	for (const dir of [root, foreign, nested]) mkdirSync(dir, {recursive: true});
	const alias = path.join(base, 'alias');
	const outside = path.join(root, 'outside-link');
	symlinkSync(root, alias, 'junction');
	symlinkSync(foreign, outside, 'junction');
	return {base, root, foreign, nested, alias, outside};
}

function row(cwd: string, sessionId = 'known', overrides = {}) {
	return {
		sessionId,
		cwd,
		title: ' saved session ',
		updatedAt: timestamp,
		...overrides,
	};
}

function proof(cwd: string, id = 'known', reportedCwd = cwd) {
	return {
		session: {
			id,
			title: 'saved session',
			sessionCwd: cwd,
			lastActivityAt: timestamp,
		},
		reportedCwd,
	};
}

test('ACP-18 mixed-root discovery keeps native exact roots and aliases, never reads foreign titles', async t => {
	const f = fixture(t);
	const privateRow = (cwd: string, id: string) => ({
		sessionId: id,
		cwd,
		get title(): string {
			t.fail('A foreign title must not be projected');
			throw new Error('private foreign title');
		},
	});
	const caseAlias = path.join(f.base, 'PROJECT');
	let caseResolves = false;
	try {
		caseResolves = realpathSync.native(caseAlias) === f.root;
	} catch {}
	const rows = [
		row(f.root),
		row(f.alias, 'alias'),
		row(caseAlias, 'case-alias'),
		privateRow(f.nested, 'nested'),
		privateRow(f.foreign, 'foreign'),
		privateRow(f.outside, 'outside-symlink'),
		privateRow(path.join(f.base, 'project-sibling'), 'prefix-sibling'),
	];
	t.deepEqual(await sessionDiscovery({sessions: rows}, f.root), [
		proof(f.root, 'alias', f.alias),
		...(caseResolves ? [proof(f.root, 'case-alias', caseAlias)] : []),
		proof(f.root),
	]);
});

test('ACP-18 discovery drops malformed IDs, missing/relative cwd and invalid timestamps without losing a valid row', async t => {
	const f = fixture(t);
	const invalid = ['', ' ', '\uD800', 'é'.repeat(101), 'session\u202e'];
	t.deepEqual(
		await sessionDiscovery(
			{
				sessions: [
					row(f.root),
					...invalid.map(id => row(f.root, id)),
					row('relative', 'relative'),
					row(`${f.root}\0`, 'nul'),
					row(path.join(f.base, 'missing'), 'missing'),
					row(f.root, 'invalid-time', {updatedAt: 'yesterday'}),
					null,
					[],
				],
			},
			f.root,
		),
		[proof(f.root)],
	);
});

test('ACP-18 ambiguous session IDs fail closed even when one duplicate belongs to another root', async t => {
	const f = fixture(t);
	t.deepEqual(
		await sessionDiscovery(
			{
				sessions: [
					row(f.root),
					row(f.root, 'duplicate'),
					row(f.foreign, 'duplicate'),
					row(f.root, 'identical'),
					row(f.root, 'identical'),
				],
			},
			f.root,
		),
		[proof(f.root)],
	);
});

test('ACP-18 discovery allowlists bounded plain titles and sorts newest first without normalising opaque IDs', async t => {
	const f = fixture(t);
	const title = ['<script>', 'inert title', '</script>'].join('');
	const result = await sessionDiscovery(
		{
			sessions: [
				row(f.root),
				row(f.root, ' session/é/\u{1F680}', {
					title: ` ${title} `,
					updatedAt: '2026-10-30T12:00:00.000Z',
					content: 'must not be projected',
				}),
				row(f.root, 'oversize', {title: 'x'.repeat(501)}),
				row(f.root, 'empty', {title: '   '}),
				row(f.root, 'unknown-time', {
					title: undefined,
					updatedAt: undefined,
				}),
			],
		},
		f.root,
	);
	t.deepEqual(result, [
		{
			session: {
				id: ' session/é/\u{1F680}',
				title,
				sessionCwd: f.root,
				lastActivityAt: '2026-10-30T12:00:00.000Z',
			},
			reportedCwd: f.root,
		},
		proof(f.root),
		{
			session: {
				id: 'unknown-time',
				title: 'untitled session',
				sessionCwd: f.root,
				lastActivityAt: null,
			},
			reportedCwd: f.root,
		},
	]);
});

test('ACP-18 discovery refuses an over-512-session response instead of publishing a truncated prefix', async t => {
	const f = fixture(t);
	const entries = Array.from({length: 512}, (_, index) =>
		row(f.root, `session-${index}`),
	);
	t.is((await sessionDiscovery({sessions: entries}, f.root)).length, 512);
	t.deepEqual(
		await sessionDiscovery(
			{sessions: [...entries, row(f.root, 'overflow')]},
			f.root,
		),
		[],
	);
});

test('ACP-18 discovery refuses over-512KiB UTF-8 metadata without publishing any prefix', async t => {
	const f = fixture(t);
	const entries = Array.from({length: 400}, (_, index) =>
		row(f.root, `session-${index}`, {title: '界'.repeat(500)}),
	);
	t.deepEqual(await sessionDiscovery({sessions: entries}, f.root), []);
});

test('ACP-18 discovery neither copies unknown payload fields nor accepts a noncanonical project root', async t => {
	const f = fixture(t);
	const response = {
		sessions: [row(f.root, 'known', {content: 'ignored'.repeat(100_000)})],
	};
	t.deepEqual(await sessionDiscovery(response, f.root), [proof(f.root)]);
	t.deepEqual(await sessionDiscovery(response, f.alias), []);
	for (const malformed of [null, [], {}, {sessions: null}])
		t.deepEqual(await sessionDiscovery(malformed, f.root), []);
});
