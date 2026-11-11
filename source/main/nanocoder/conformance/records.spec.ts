import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {describeAgent} from '@/main/nanocoder/capabilities';
import {
	gatesFor,
	readRecord,
	recordedVersions,
} from '@/main/nanocoder/conformance/records';
import {
	LAST_TESTED_VERSION,
	versionPolicy,
} from '@/main/nanocoder/version-policy';

const bundled = JSON.parse(
	readFileSync(path.resolve('scripts', 'nanocoder-bundle.json'), 'utf8'),
).version as string;

test('the bundled version and the last tested version each have a recorded initialize answer (ACP-04 ACP-21)', t => {
	const recorded = recordedVersions();
	t.true(recorded.includes(bundled), `no record for the bundled ${bundled}`);
	t.true(
		recorded.includes(LAST_TESTED_VERSION),
		`no record for the tested ${LAST_TESTED_VERSION}`,
	);
});

test('every record names its own version and keeps the gate results its recorded answer produces (ACP-03 ACP-04)', t => {
	for (const version of recordedVersions()) {
		const record = readRecord(version);
		if (!record) {
			t.fail(`record ${version} cannot be read`);
			continue;
		}
		t.is(record.version, version);
		t.is(record.initialize.agentInfo?.version, version);
		t.deepEqual(
			record.gates,
			gatesFor(record.initialize),
			`gate results for ${version} changed: re-record it after reading why`,
		);
	}
});

test('every recorded version is one the policy accepts, and none is the unsupported published 1.31.0 (ACP-04)', t => {
	for (const version of recordedVersions()) {
		const status = versionPolicy(version, bundled).status;
		t.true(
			status === 'bundled' || status === 'supported',
			`${version} is ${status}`,
		);
		t.not(version, '1.31.0');
	}
});

test('every record says which gates rest on assumed inputs rather than the recorded answer (ACP-03)', t => {
	for (const version of recordedVersions()) {
		t.deepEqual(readRecord(version)?.gates.assumed, [
			'rename',
			'timeline',
			'browserControl',
		]);
	}
});

test('a recorded answer that lacks a capability leaves the gate closed with its reason (ACP-03)', t => {
	const record = readRecord(bundled);
	if (!record) return t.fail('no bundled record');
	const stripped = {
		...record.initialize,
		agentCapabilities: {loadSession: true},
	};
	const gates = gatesFor(stripped);
	t.false(gates.features.resume);
	t.false(gates.features.browserControl);
	t.false(describeAgent('/r', stripped).capabilities.perSessionModel);
});
