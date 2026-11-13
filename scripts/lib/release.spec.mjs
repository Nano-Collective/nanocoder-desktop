import test from 'ava';
import {
	checksumFile,
	extractChangelog,
	releaseDecision,
	releaseNotes,
} from './release.mjs';

test('REL-09 a version that was never bumped is not released', t => {
	const decision = releaseDecision({version: '0.0.0', exists: false});
	t.false(decision.release);
	t.regex(decision.reason, /never been versioned/);
});

test('REL-09 a version that already has a release is not released again', t => {
	const decision = releaseDecision({
		version: '0.1.0-alpha.0',
		exists: true,
	});
	t.false(decision.release);
	t.regex(decision.reason, /already/);
});

test('REL-09 a new alpha version is released as a prerelease with a v tag', t => {
	t.deepEqual(releaseDecision({version: '0.1.0-alpha.0', exists: false}), {
		release: true,
		prerelease: true,
		tag: 'v0.1.0-alpha.0',
		reason: 'v0.1.0-alpha.0 has no release yet',
	});
});

test('REL-09 a stable version is not marked as a prerelease', t => {
	const decision = releaseDecision({version: '1.0.0', exists: false});
	t.true(decision.release);
	t.false(decision.prerelease);
});

test('REL-09 a version that is not plain semver is refused, never passed to a shell', t => {
	for (const version of ['', 'v1.0.0', '1.0', '1.0.0; rm -rf /', '$(id)']) {
		t.throws(() => releaseDecision({version, exists: false}), {
			message: /not a valid version/,
		});
	}
});

test('REL-12 checksums use the sha256sum layout, sorted by name', t => {
	const text = checksumFile([
		{name: 'b.dmg', sha256: 'b'.repeat(64)},
		{name: 'a.exe', sha256: 'a'.repeat(64)},
	]);
	t.is(text, `${'a'.repeat(64)}  a.exe\n${'b'.repeat(64)}  b.dmg\n`);
});

test('REL-12 a checksum that is not 64 hex characters is refused', t => {
	t.throws(() => checksumFile([{name: 'a.exe', sha256: 'xyz'}]), {
		message: /SHA-256/,
	});
});

test('REL-12 a file name that could break the checksum layout is refused', t => {
	for (const name of ['a\nb.exe', 'a b/../c.exe', '../a.exe', '']) {
		t.throws(
			() => checksumFile([{name, sha256: 'a'.repeat(64)}]),
			undefined,
			name,
		);
	}
});

const changelog = [
	'# 0.1.0-alpha.1',
	'',
	'- second change',
	'',
	'# 0.1.0-alpha.0',
	'',
	'- first change',
	'- another change',
	'',
].join('\n');

test('REL-09 the changelog section for one version is extracted, and only that one', t => {
	t.is(
		extractChangelog(changelog, '0.1.0-alpha.0'),
		'- first change\n- another change',
	);
	t.is(extractChangelog(changelog, '0.1.0-alpha.1'), '- second change');
});

test('REL-09 a version missing from the changelog is an error, not an empty release', t => {
	t.throws(() => extractChangelog(changelog, '0.2.0'), {
		message: /no changelog entry/,
	});
	t.throws(() => extractChangelog('# 0.1.0-alpha.0\n\n', '0.1.0-alpha.0'), {
		message: /no changelog entry/,
	});
});

test('REL-09 a version is matched whole, not as a prefix of a longer one', t => {
	const text = '# 0.1.0-alpha.10\n\n- ten\n\n# 0.1.0-alpha.1\n\n- one\n';
	t.is(extractChangelog(text, '0.1.0-alpha.1'), '- one');
});

test('REL-10 prerelease notes state pre-v0.1 status and that the build is unsigned', t => {
	const notes = releaseNotes({
		version: '0.1.0-alpha.0',
		prerelease: true,
		changelog: '- first change',
	});
	t.regex(notes, /pre-v0\.1/i);
	t.regex(notes, /stability is not promised/i);
	t.regex(notes, /not signed/);
	t.regex(notes, /SHA256SUMS\.txt/);
	t.regex(notes, /- first change/);
	t.false(notes.includes(String.fromCharCode(0x2014)));
});

test('REL-10 a stable release does not carry the pre-v0.1 notice', t => {
	const notes = releaseNotes({
		version: '1.0.0',
		prerelease: false,
		changelog: '- change',
	});
	t.notRegex(notes, /pre-v0\.1/i);
});
