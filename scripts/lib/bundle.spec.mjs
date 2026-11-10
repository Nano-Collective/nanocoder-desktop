import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	bundledLayout,
	verifyBundleLock,
	verifyInstalledNanocoder,
} from './bundle.mjs';

const pin = {
	package: '@nanocollective/nanocoder',
	version: '1.32.0',
	integrity: 'sha512-AAAA',
};

const lock = (overrides = {}) => ({
	lockfileVersion: 3,
	packages: {
		'': {dependencies: {'@nanocollective/nanocoder': '1.32.0'}},
		'node_modules/@nanocollective/nanocoder': {
			version: '1.32.0',
			resolved:
				'https://registry.npmjs.org/@nanocollective/nanocoder/-/nanocoder-1.32.0.tgz',
			integrity: 'sha512-AAAA',
		},
		'node_modules/chalk': {
			version: '5.0.0',
			resolved: 'https://registry.npmjs.org/chalk/-/chalk-5.0.0.tgz',
			integrity: 'sha512-BBBB',
		},
		...overrides,
	},
});

test('REL-11 a lock that names exactly the pinned Nanocoder tarball passes', t => {
	t.notThrows(() => verifyBundleLock(lock(), pin));
});

test('REL-11 a different version, tarball hash or dependency range is refused', t => {
	const entry = 'node_modules/@nanocollective/nanocoder';
	const base = lock().packages[entry];
	t.throws(
		() => verifyBundleLock(lock({[entry]: {...base, version: '1.33.0'}}), pin),
		{message: /version/},
	);
	t.throws(
		() =>
			verifyBundleLock(
				lock({[entry]: {...base, integrity: 'sha512-ZZZZ'}}),
				pin,
			),
		{message: /integrity/},
	);
	t.throws(
		() =>
			verifyBundleLock(
				lock({'': {dependencies: {'@nanocollective/nanocoder': '^1.32.0'}}}),
				pin,
			),
		{message: /exact/},
	);
	const missing = lock();
	delete missing.packages[entry];
	t.throws(() => verifyBundleLock(missing, pin), {message: /not in the lock/});
});

test('REL-11 every locked package needs an integrity hash and a registry address', t => {
	t.throws(
		() =>
			verifyBundleLock(
				lock({
					'node_modules/odd': {
						version: '1.0.0',
						resolved: 'https://registry.npmjs.org/odd/-/odd-1.0.0.tgz',
					},
				}),
				pin,
			),
		{message: /node_modules\/odd.*integrity/},
	);
	for (const resolved of [
		'git+ssh://git@github.com/x/odd.git#abc',
		'https://example.com/odd-1.0.0.tgz',
		'file:../odd',
	])
		t.throws(
			() =>
				verifyBundleLock(
					lock({
						'node_modules/odd': {
							version: '1.0.0',
							resolved,
							integrity: 'sha512-CCCC',
						},
					}),
					pin,
				),
			{message: /node_modules\/odd.*registry/},
			resolved,
		);
	t.notThrows(() =>
		verifyBundleLock(
			lock({'node_modules/linked': {link: true, resolved: 'x'}}),
			pin,
		),
	);
});

test('REL-02 the installed package must be the pinned Nanocoder with its cli where bin says', t => {
	const root = mkdtempSync(path.join(tmpdir(), 'nd-bundle-'));
	t.teardown(() => rmSync(root, {recursive: true, force: true}));
	const dir = path.join(root, 'node_modules', '@nanocollective', 'nanocoder');
	mkdirSync(path.join(dir, 'dist'), {recursive: true});
	writeFileSync(path.join(dir, 'dist', 'cli.js'), '');
	const write = pkg =>
		writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
	write({
		name: '@nanocollective/nanocoder',
		version: '1.32.0',
		bin: {nanocoder: 'dist/cli.js'},
	});
	t.is(verifyInstalledNanocoder(root, pin), path.join(dir, 'dist', 'cli.js'));
	write({
		name: '@nanocollective/nanocoder',
		version: '1.31.0',
		bin: {nanocoder: 'dist/cli.js'},
	});
	t.throws(() => verifyInstalledNanocoder(root, pin), {message: /1\.31\.0/});
	write({name: 'other', version: '1.32.0', bin: {nanocoder: 'dist/cli.js'}});
	t.throws(() => verifyInstalledNanocoder(root, pin), {message: /name/});
	write({
		name: '@nanocollective/nanocoder',
		version: '1.32.0',
		bin: {nanocoder: 'dist/other.js'},
	});
	t.throws(() => verifyInstalledNanocoder(root, pin), {message: /cli/});
});

test('REL-02 the bundled layout is one folder for Node and one for Nanocoder, with the platform binary name', t => {
	t.deepEqual(bundledLayout('linux'), {
		node: ['node', 'node'],
		cli: [
			'nanocoder',
			'node_modules',
			'@nanocollective',
			'nanocoder',
			'dist',
			'cli.js',
		],
	});
	t.deepEqual(bundledLayout('win32').node, ['node', 'node.exe']);
	t.deepEqual(bundledLayout('darwin').node, ['node', 'node']);
});
