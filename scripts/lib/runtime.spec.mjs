import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	classifyInitializeReply,
	formatMb,
	formatReport,
	measurementEnv,
	median,
	nodeBinaryPath,
	parseResidentKb,
	pinnedArchive,
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
	// What `ps -o rss= -p <pid>` prints on macOS: padded kilobytes.
	t.is(parseResidentKb('  98765\n', 'darwin'), 98765);
	t.is(parseResidentKb('', 'linux'), undefined);
	t.is(parseResidentKb('INFO: No tasks are running.', 'win32'), undefined);
});

test('formats bytes as megabytes', t => {
	t.is(formatMb(104857600), '100.0 MB');
});

const pin = {archives: {'linux-x64': {file: 'node.tar.gz', sha256: 'a'}}};

test('finds the pinned archive for this machine', t => {
	t.deepEqual(pinnedArchive(pin, 'linux', 'x64'), {
		key: 'linux-x64',
		archive: {file: 'node.tar.gz', sha256: 'a'},
	});
});

test('says clearly when nothing is pinned for this machine', t => {
	t.throws(() => pinnedArchive(pin, 'linux', 'arm64'), {
		message: 'Nothing is pinned for linux-arm64',
	});
});

test('drops the variables that change how Node loads code, in any case', t => {
	t.deepEqual(
		measurementEnv(
			{
				PATH: '/bin',
				NODE_OPTIONS: '--require=evil',
				node_options: '--require=evil',
				ELECTRON_RUN_AS_NODE: '1',
				NODE_ENV: 'test',
				OPENAI_API_KEY: 'kept',
			},
			{ELECTRON_RUN_AS_NODE: '1'},
		),
		{PATH: '/bin', OPENAI_API_KEY: 'kept', ELECTRON_RUN_AS_NODE: '1'},
	);
});

const reply = frame => classifyInitializeReply(JSON.stringify(frame));

test('counts only a real answer to initialize as a good run', t => {
	t.deepEqual(reply({jsonrpc: '2.0', id: 0, result: {protocolVersion: 1}}), {
		kind: 'answered',
	});
});

test('counts an error answer to initialize as a failure, with its message', t => {
	t.deepEqual(
		reply({
			jsonrpc: '2.0',
			id: 0,
			error: {code: -32603, message: 'Internal error'},
		}),
		{kind: 'failed', reason: 'initialize returned an error: Internal error'},
	);
	t.deepEqual(reply({jsonrpc: '2.0', id: 0, error: {}}), {
		kind: 'failed',
		reason: 'initialize returned an error: unknown error',
	});
});

test('counts an answer with no result as a failure', t => {
	t.deepEqual(reply({jsonrpc: '2.0', id: 0}), {
		kind: 'failed',
		reason: 'initialize returned no result',
	});
	t.deepEqual(reply({jsonrpc: '2.0', id: 0, result: 'text'}), {
		kind: 'failed',
		reason: 'initialize returned no result',
	});
});

test('ignores frames that are not the answer to initialize', t => {
	t.deepEqual(reply({jsonrpc: '2.0', id: 7, result: {}}), {kind: 'ignore'});
	t.deepEqual(reply({jsonrpc: '2.0', method: 'session/update'}), {
		kind: 'ignore',
	});
	t.deepEqual(classifyInitializeReply('null'), {kind: 'ignore'});
	t.deepEqual(classifyInitializeReply('42'), {kind: 'ignore'});
});

test('fails a line that is not JSON at all', t => {
	t.deepEqual(classifyInitializeReply('Starting Nanocoder...'), {
		kind: 'failed',
		reason: 'stdout was not ACP',
	});
});

const run = (name, node) => ({
	name,
	node,
	runs: 5,
	failures: 1,
	failureReasons: ['exited with code 1'],
	startupMs: {min: 1000, median: 1250.4, max: 2000},
	residentMb: {min: 200, median: 217.2, max: 230},
});

test('lays the report out as a table with the side results', t => {
	const text = formatReport(
		{
			platform: 'darwin-arm64',
			sidecar: {binaryBytes: 104857600},
			runtimes: [
				run('Electron Node mode', '24.22.0'),
				run('Node sidecar', '22.23.4'),
			],
			noNodeOnPath: {
				'Electron Node mode': {ok: true},
				'Node sidecar': {valid: false},
			},
			hardenedRuntime: [
				{label: 'no entitlements', ok: false, reason: 'exited with code 1'},
				{label: 'allow-jit', ok: true},
			],
		},
		'v22.23.4',
	);
	t.is(
		text,
		[
			'### Runtime measurement, darwin-arm64',
			'',
			'| Runtime | Node | Startup ms, median (range) | Idle memory MB, median (range) | Failures |',
			'|---|---|---|---|---|',
			'| Electron Node mode | 24.22.0 | 1250 (1000 to 2000) | 217 (200 to 230) | 1 of 5: exited with code 1 |',
			'| Node sidecar | 22.23.4 | 1250 (1000 to 2000) | 217 (200 to 230) | 1 of 5: exited with code 1 |',
			'',
			'Sidecar binary: 100.0 MB unpacked (v22.23.4).',
			'',
			'- Electron Node mode without Node on PATH: starts',
			'- Node sidecar without Node on PATH: not testable here, a system Node is on the minimal PATH',
			'',
			'Hardened runtime, sidecar signed ad hoc:',
			'- no entitlements: fails (exited with code 1)',
			'- allow-jit: starts',
			'',
		].join('\n'),
	);
});

test('leaves out the hardened runtime section off macOS and shows missing numbers', t => {
	const text = formatReport(
		{
			platform: 'linux-x64',
			sidecar: {binaryBytes: 1048576},
			runtimes: [
				{
					...run('Node sidecar', '22.23.4'),
					failureReasons: [],
					startupMs: undefined,
					residentMb: undefined,
				},
			],
			noNodeOnPath: {},
			hardenedRuntime: null,
		},
		'v22.23.4',
	);
	t.false(text.includes('Hardened runtime'));
	t.true(text.includes('| Node sidecar | 22.23.4 | n/a | n/a | 1 of 5 |'));
});
