import {existsSync, mkdirSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {canonicalPath, canonicalPathSync, isInside} from '@/main/paths';

test('native canonicalisation follows the actual volume case identity', async t => {
	const work = canonicalPathSync(mkdtempSync(path.join(tmpdir(), 'nd-case-')));
	t.teardown(() => rmSync(work, {recursive: true, force: true}));
	const root = path.join(work, 'CaseProject');
	const alias = path.join(work, 'caseproject');
	mkdirSync(root);
	if (existsSync(alias)) {
		t.is(statSync(alias).dev, statSync(root).dev);
		t.is(statSync(alias).ino, statSync(root).ino);
		t.is(canonicalPathSync(alias), canonicalPathSync(root));
		t.is(await canonicalPath(alias), canonicalPathSync(root));
		t.log('case-insensitive volume: native realpath returns on-disk casing');
	} else {
		mkdirSync(alias);
		t.not(canonicalPathSync(alias), canonicalPathSync(root));
		t.false(isInside(await canonicalPath(alias), [canonicalPathSync(root)]));
		t.log('case-sensitive volume: distinct case names remain distinct');
	}
	await t.throwsAsync(canonicalPath(path.join(work, 'missing')));
});

test('two-dot-prefixed names are children, not parent segments', t => {
	for (const child of [
		'/a/project',
		'/a/project/..tools/node',
		'/a/project/..tools/nanocoder/dist/cli.js',
		'/a/project/.../x',
	])
		t.true(isInside(child, ['/a/project'], 'linux'), child);
	for (const child of [
		'/a/project/..',
		'/a/project/../x',
		'/a/project-other/x',
		'..',
		'../x',
		'relative',
	])
		t.false(isInside(child, ['/a/project'], 'linux'), child);
	t.false(isInside('/a/project', ['relative'], 'linux'));
});

test('normalised paths and filesystem roots retain their segment boundaries', t => {
	t.true(isInside('/a/project/a/../..tools/node', ['/a/project/'], 'linux'));
	t.true(isInside('/..tools/node', ['/'], 'linux'));
	t.false(isInside('/a/project/../../x', ['/a/project'], 'linux'));
	t.false(isInside('/a/project', [], 'linux'));
});

test('Windows drive, UNC root and separator boundaries never cross', t => {
	const root = 'C:\\a\\project';
	for (const child of [
		'C:\\a\\project',
		'C:\\a\\project\\..tools\\node',
		'c:/a/project/..tools/nanocoder/dist/cli.js',
	])
		t.true(isInside(child, [root], 'win32'), child);
	for (const child of [
		'C:\\a\\project\\..',
		'C:\\a\\project\\..\\x',
		'C:\\a\\project-other\\node',
		'D:\\a\\project\\node',
		'\\a\\project\\node',
		'C:a\\project\\node',
		'\\\\server\\share\\a\\project\\node',
	])
		t.false(isInside(child, [root], 'win32'), child);
	t.true(
		isInside(
			'\\\\server\\share\\project\\..tools\\node',
			['\\\\server\\share\\project'],
			'win32',
		),
	);
	t.false(
		isInside(
			'\\\\server\\other\\project\\node',
			['\\\\server\\share\\project'],
			'win32',
		),
	);
	t.false(
		isInside(
			'\\\\other\\share\\project\\node',
			['\\\\server\\share\\project'],
			'win32',
		),
	);
});

test('canonical POSIX paths remain case-sensitive, including on macOS', t => {
	t.false(isInside('/Work/Project/node', ['/work/project'], 'darwin'));
	t.false(isInside('/Work/Project/node', ['/work/project'], 'linux'));
	t.true(isInside('C:\\Work\\Project\\node', ['c:\\work\\project'], 'win32'));
});
