import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	formatMb,
	median,
	nodeBinaryPath,
	parseResidentKb,
	platformKey,
	sha256File,
	summarise,
	verifyArchive,
} from './runtime.mjs';

test('names the pinned archive for each platform', t => {
	t.is(platformKey('darwin', 'arm64'), 'darwin-arm64');
	t.is(platformKey('darwin', 'x64'), 'darwin-x64');
	t.is(platformKey('linux', 'x64'), 'linux-x64');
	t.is(platformKey('win32', 'x64'), 'win-x64');
});

test('refuses a platform it has no sidecar for', t => {
	t.throws(() => platformKey('freebsd', 'x64'), {
		message: 'No Node sidecar for platform freebsd',
	});
});

test('finds the node binary inside the extracted archive', t => {
	t.is(
		nodeBinaryPath('/cache', 'v22.1.0', 'linux-x64', 'linux'),
		path.join('/cache', 'node-v22.1.0-linux-x64', 'bin', 'node'),
	);
	t.is(
		nodeBinaryPath('C:\\cache', 'v22.1.0', 'win-x64', 'win32'),
		path.join('C:\\cache', 'node-v22.1.0-win-x64', 'node.exe'),
	);
});

test('hashes a file, and accepts only the pinned hash', async t => {
	const dir = mkdtempSync(path.join(tmpdir(), 'nd-sha-'));
	const file = path.join(dir, 'archive');
	writeFileSync(file, 'abc');
	const abc =
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
	t.is(await sha256File(file), abc);
	await verifyArchive(file, abc);
	await t.throwsAsync(verifyArchive(file, 'a'.repeat(64)), {
		message:
			/^Checksum mismatch: expected aaaaaaaaaaaa\.\.\., got ba7816bf8f01\.\.\.$/,
	});
	rmSync(dir, {recursive: true, force: true});
});

test('takes the median of odd and even counts', t => {
	t.is(median([3, 1, 2]), 2);
	t.is(median([4, 1, 3, 2]), 2.5);
	t.is(median([7]), 7);
	t.is(median([]), undefined);
});

test('summarises a set of runs', t => {
	t.deepEqual(summarise([5, 1, 3]), {min: 1, median: 3, max: 5});
	t.is(summarise([]), undefined);
});

test('reads resident memory from ps and tasklist output', t => {
	t.is(parseResidentKb(' 123456\n', 'linux'), 123456);
	t.is(
		parseResidentKb('"node.exe","4242","Console","1","152,340 K"\r\n', 'win32'),
		152340,
	);
	t.is(parseResidentKb('', 'darwin'), undefined);
	t.is(parseResidentKb('INFO: No tasks are running.', 'win32'), undefined);
});

test('formats bytes as megabytes', t => {
	t.is(formatMb(104857600), '100.0 MB');
});
