import {readFileSync} from 'node:fs';
import path from 'node:path';
import {getCurrentFuseWire} from '@electron/fuses';
import test from 'ava';
import electronPath from 'electron';
import YAML from 'yaml';
import {FUSE_POLICY, fuseViolations, wireOf} from './fuses.mjs';

const ON = 49;
const OFF = 48;

// A wire that meets the policy, built from the policy itself.
const good = () => {
	const wire = {version: '1', 8: ON};
	for (const {index, enabled} of Object.values(FUSE_POLICY))
		wire[index] = enabled ? ON : OFF;
	return wire;
};

test('SEC-19 a wire with the policy applied has no violations', t => {
	t.deepEqual(fuseViolations(good()), []);
});

test('SEC-19 each forbidden fuse left on is reported by name', t => {
	for (const name of [
		'runAsNode',
		'enableNodeOptionsEnvironmentVariable',
		'enableNodeCliInspectArguments',
		'grantFileProtocolExtraPrivileges',
	]) {
		const wire = good();
		wire[FUSE_POLICY[name].index] = ON;
		t.deepEqual(fuseViolations(wire), [`${name} is on, and must be off`], name);
	}
});

test('SEC-19 a fuse that must be on is reported when it is off or missing', t => {
	for (const name of [
		'onlyLoadAppFromAsar',
		'enableEmbeddedAsarIntegrityValidation',
	]) {
		const off = good();
		off[FUSE_POLICY[name].index] = OFF;
		t.deepEqual(fuseViolations(off), [`${name} is off, and must be on`], name);
		const missing = good();
		delete missing[FUSE_POLICY[name].index];
		t.deepEqual(
			fuseViolations(missing),
			[`${name} is missing, and must be on`],
			name,
		);
	}
});

test('SEC-19 an unknown fuse state, or a different wire version, is a violation, never a pass', t => {
	const removed = good();
	removed[FUSE_POLICY.runAsNode.index] = 114;
	t.deepEqual(fuseViolations(removed), [
		'runAsNode is removed, and must be off',
	]);
	t.deepEqual(fuseViolations({...good(), version: '2'}), [
		'The fuse wire is version 2, not 1',
	]);
	t.deepEqual(fuseViolations(undefined), ['No fuse wire could be read']);
});

test('SEC-19 the fuse policy names the three fuses the bundled Node lets us turn off', t => {
	for (const name of [
		'runAsNode',
		'enableNodeOptionsEnvironmentVariable',
		'enableNodeCliInspectArguments',
	])
		t.false(FUSE_POLICY[name].enabled, name);
});

test('SEC-19 the electron-builder options and the policy agree', t => {
	t.deepEqual(wireOf(FUSE_POLICY), {
		runAsNode: false,
		enableCookieEncryption: false,
		enableNodeOptionsEnvironmentVariable: false,
		enableNodeCliInspectArguments: false,
		enableEmbeddedAsarIntegrityValidation: true,
		onlyLoadAppFromAsar: true,
		loadBrowserProcessSpecificV8Snapshot: false,
		grantFileProtocolExtraPrivileges: false,
	});
});

test('SEC-19 electron-builder.yml sets exactly the fuses the policy names', t => {
	const config = YAML.parse(
		readFileSync(
			path.resolve(import.meta.dirname, '..', '..', 'electron-builder.yml'),
			'utf8',
		),
	);
	t.deepEqual(config.electronFuses, {
		...wireOf(FUSE_POLICY),
		resetAdHocDarwinSignature: true,
	});
});

// The decoder is checked against the real library and a real Electron, not only against itself.
test('SEC-19 the decoder reads the wire @electron/fuses returns from a real, unfused Electron', async t => {
	const wire = await getCurrentFuseWire(electronPath);
	t.is(wire.version, '1');
	// Electron ships these defaults: runAsNode, nodeOptions, nodeCliInspect and file privileges on; the rest off.
	t.deepEqual(
		[0, 1, 2, 3, 4, 5, 6, 7].map(index => wire[index]),
		[49, 48, 49, 49, 48, 48, 48, 49],
	);
	// Index 8 is a fuse this library version does not name; the policy does not use it.
	t.deepEqual(fuseViolations(wire), [
		'runAsNode is on, and must be off',
		'enableNodeOptionsEnvironmentVariable is on, and must be off',
		'enableNodeCliInspectArguments is on, and must be off',
		'enableEmbeddedAsarIntegrityValidation is off, and must be on',
		'onlyLoadAppFromAsar is off, and must be on',
		'grantFileProtocolExtraPrivileges is on, and must be off',
	]);
});
