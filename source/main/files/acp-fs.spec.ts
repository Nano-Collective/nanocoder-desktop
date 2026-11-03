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
import {RequestError} from '@agentclientprotocol/sdk';
import test, {type ExecutionContext} from 'ava';
import {readTextForAgent} from '@/main/files/acp-fs';
import {FILE_LIMITS} from '@/main/files/limits';

function project(t: ExecutionContext) {
	const base = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-acpfs-')),
	);
	t.teardown(() => rmSync(base, {recursive: true, force: true}));
	const root = path.join(base, 'project');
	const outside = path.join(base, 'outside');
	mkdirSync(path.join(root, 'src'), {recursive: true});
	mkdirSync(path.join(root, '.git'));
	mkdirSync(outside);
	writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
	writeFileSync(path.join(root, '.git/config'), '[core]');
	writeFileSync(path.join(root, 'src/a.ts'), 'one\ntwo\nthree\nfour\n');
	return {base, root, outside};
}

const refusal = (code: number) => ({instanceOf: RequestError, code});

test('ACP-11 a file inside the project is read whole', async t => {
	const f = project(t);
	t.deepEqual(
		await readTextForAgent(f.root, {path: path.join(f.root, 'src/a.ts')}),
		{content: 'one\ntwo\nthree\nfour\n'},
	);
});

test('ACP-11 a line range returns only those lines', async t => {
	const f = project(t);
	const file = path.join(f.root, 'src/a.ts');
	t.is(
		(await readTextForAgent(f.root, {path: file, line: 2, limit: 2})).content,
		'two\nthree\n',
	);
	t.is(
		(await readTextForAgent(f.root, {path: file, line: 3})).content,
		'three\nfour\n',
	);
	t.is(
		(await readTextForAgent(f.root, {path: file, limit: 1})).content,
		'one\n',
	);
	t.is((await readTextForAgent(f.root, {path: file, line: 99})).content, '');
	t.is(
		(await readTextForAgent(f.root, {path: file, line: null, limit: null}))
			.content,
		'one\ntwo\nthree\nfour\n',
	);
});

test('ACP-11 SEC-20 paths outside the project are refused without reading them', async t => {
	const f = project(t);
	for (const bad of [
		path.join(f.outside, 'secret.txt'),
		path.join(f.root, '..', 'outside', 'secret.txt'),
		`${f.root}-evil/a.ts`,
		path.dirname(f.root),
	])
		await t.throwsAsync(
			readTextForAgent(f.root, {path: bad}),
			refusal(-32602),
			bad,
		);
	for (const bad of ['src/a.ts', './src/a.ts', '', 'a\u0000b'])
		await t.throwsAsync(
			readTextForAgent(f.root, {path: bad}),
			refusal(-32602),
			bad,
		);
});

test('ACP-11 SEC-20 a link or junction that leaves the project is refused', async t => {
	const f = project(t);
	try {
		symlinkSync(f.outside, path.join(f.root, 'escape'), 'junction');
		symlinkSync(
			path.join(f.outside, 'secret.txt'),
			path.join(f.root, 'secret-link.txt'),
			'file',
		);
	} catch {
		t.pass('this account cannot create links');
		return;
	}
	for (const name of ['escape/secret.txt', 'secret-link.txt']) {
		const error = await t.throwsAsync(
			readTextForAgent(f.root, {path: path.join(f.root, name)}),
			refusal(-32602),
			name,
		);
		t.false(error?.message.includes('secret'));
	}
});

test('ACP-11 the .git folder is not readable through the agent either', async t => {
	const f = project(t);
	await t.throwsAsync(
		readTextForAgent(f.root, {path: path.join(f.root, '.git/config')}),
		refusal(-32602),
	);
});

test('ACP-11 a missing path, a folder and non-text are refused with clear errors', async t => {
	const f = project(t);
	writeFileSync(path.join(f.root, 'blob.bin'), Buffer.from([1, 0, 2]));
	writeFileSync(path.join(f.root, 'latin1.txt'), Buffer.from([0x63, 0xe9]));
	await t.throwsAsync(
		readTextForAgent(f.root, {path: path.join(f.root, 'missing.ts')}),
		refusal(-32002),
	);
	await t.throwsAsync(
		readTextForAgent(f.root, {path: path.join(f.root, 'src')}),
		refusal(-32602),
	);
	for (const name of ['blob.bin', 'latin1.txt'])
		await t.throwsAsync(
			readTextForAgent(f.root, {path: path.join(f.root, name)}),
			refusal(-32602),
			name,
		);
});

test('ACP-11 invalid line numbers and limits are refused', async t => {
	const f = project(t);
	const file = path.join(f.root, 'src/a.ts');
	for (const params of [
		{line: 0},
		{line: -1},
		{line: 1.5},
		{limit: 0},
		{limit: 2_000_000},
		{limit: 0.5},
	])
		await t.throwsAsync(
			readTextForAgent(f.root, {path: file, ...params}),
			refusal(-32602),
		);
});

test('SEC-04 ACP-11 a file over 1 MiB needs a line range, and the range stays bounded', async t => {
	const f = project(t);
	const body = Array.from(
		{length: 40_000},
		(_, index) => `line ${index + 1}`,
	).join('\n');
	const file = path.join(f.root, 'big.txt');
	writeFileSync(file, `${body}\n`);
	writeFileSync(file, `${body}\n${'x'.repeat(FILE_LIMITS.acpReadBytes)}\n`);
	await t.throwsAsync(readTextForAgent(f.root, {path: file}), refusal(-32000));
	t.is(
		(await readTextForAgent(f.root, {path: file, line: 1, limit: 2})).content,
		'line 1\nline 2\n',
	);
	t.is(
		(await readTextForAgent(f.root, {path: file, line: 39_999, limit: 2}))
			.content,
		'line 39999\nline 40000\n',
	);
	t.is(
		(await readTextForAgent(f.root, {path: file, line: 100_000})).content,
		'',
	);
	await t.throwsAsync(
		readTextForAgent(f.root, {path: file, line: 40_001, limit: 5}),
		refusal(-32000),
	);
});

test('ACP-11 a project folder replaced by a link is refused', async t => {
	const f = project(t);
	const alias = `${f.root}-alias`;
	try {
		symlinkSync(f.root, alias, 'junction');
	} catch {
		t.pass('this account cannot create links');
		return;
	}
	await t.throwsAsync(
		readTextForAgent(alias, {path: path.join(alias, 'src/a.ts')}),
		refusal(-32602),
	);
});
