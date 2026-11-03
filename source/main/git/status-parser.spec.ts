import test from 'ava';
import {parseStatus} from '@/main/git/status-parser';

const z = (...records: string[]) =>
	Buffer.from(`${records.join('\u0000')}\u0000`);
const oid = 'a'.repeat(40);

test('GIT-02 headers give the head commit and branch, with initial and detached forms', t => {
	t.deepEqual(parseStatus(z(`# branch.oid ${oid}`, '# branch.head main')), {
		head: oid,
		branch: 'main',
		entries: [],
		ignored: [],
	});
	t.deepEqual(
		parseStatus(z('# branch.oid (initial)', '# branch.head (detached)')),
		{
			head: null,
			branch: null,
			entries: [],
			ignored: [],
		},
	);
	t.deepEqual(parseStatus(Buffer.alloc(0)).entries, []);
});

test('GIT-02 ordinary changes map each side of the XY code', t => {
	const rec = (xy: string, path: string) =>
		`1 ${xy} N... 100644 100644 100644 ${oid} ${oid} ${path}`;
	const {entries} = parseStatus(
		z(
			rec('M.', 'a.ts'),
			rec('.M', 'b.ts'),
			rec('AM', 'c.ts'),
			rec('.D', 'd.ts'),
			rec('T.', 'e.ts'),
			rec('D.', 'f.ts'),
		),
	);
	t.deepEqual(
		entries.map(entry => [entry.path, entry.staged, entry.unstaged]),
		[
			['a.ts', 'modified', 'none'],
			['b.ts', 'none', 'modified'],
			['c.ts', 'added', 'modified'],
			['d.ts', 'none', 'deleted'],
			['e.ts', 'modified', 'none'],
			['f.ts', 'deleted', 'none'],
		],
	);
	t.true(entries.every(entry => !entry.untracked && !entry.conflicted));
});

test('GIT-02 names with spaces, newlines and quotes survive because records end in NUL', t => {
	const rec = (path: string) =>
		`1 .M N... 100644 100644 100644 ${oid} ${oid} ${path}`;
	const names = [
		'with space.ts',
		'new\nline.ts',
		'quo"te.ts',
		'caf\u00e9 \u{1f600}.ts',
		' leading.ts',
	];
	const {entries} = parseStatus(z(...names.map(rec)));
	t.deepEqual(
		entries.map(entry => entry.path),
		names,
	);
});

test('GIT-02 a rename or copy carries its original path from the extra field', t => {
	const {entries} = parseStatus(
		z(
			`2 R. N... 100644 100644 100644 ${oid} ${oid} R100 new name.ts`,
			'old name.ts',
			`2 C. N... 100644 100644 100644 ${oid} ${oid} C75 copy.ts`,
			'source.ts',
			`1 .M N... 100644 100644 100644 ${oid} ${oid} after.ts`,
		),
	);
	t.deepEqual(
		entries.map(entry => [entry.path, entry.oldPath, entry.staged]),
		[
			['new name.ts', 'old name.ts', 'renamed'],
			['copy.ts', 'source.ts', 'renamed'],
			['after.ts', null, 'none'],
		],
	);
});

test('GIT-02 unmerged, untracked and ignored records are recognised', t => {
	const parsed = parseStatus(
		z(
			`u UU N... 100644 100644 100644 100644 ${oid} ${oid} ${oid} conflict me.ts`,
			'? new file.ts',
			'? dir/inner.ts',
			'! build/',
			'! app.log',
		),
	);
	t.deepEqual(
		parsed.entries.map(entry => [
			entry.path,
			entry.conflicted,
			entry.untracked,
		]),
		[
			['conflict me.ts', true, false],
			['new file.ts', false, true],
			['dir/inner.ts', false, true],
		],
	);
	t.deepEqual(parsed.ignored, ['build/', 'app.log']);
});

test('GIT-02 malformed or unknown records are skipped, never guessed at', t => {
	const parsed = parseStatus(
		z(
			'1 too short',
			'2 short',
			'u short',
			'? ',
			'x unknown',
			'',
			'# branch.other x',
		),
	);
	t.deepEqual(parsed.entries, []);
	t.deepEqual(parsed.ignored, []);
});
