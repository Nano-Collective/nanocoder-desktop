import test from 'ava';
import {
	MIN_NANOCODER_VERSION,
	versionPolicy,
} from '@/main/nanocoder/version-policy';

test('refuses below the provisional minimum and explains the required upgrade', t => {
	const policy = versionPolicy('1.31.99');
	t.is(policy.status, 'refused');
	t.regex(policy.reason ?? '', /minimum 1\.32\.0.*Upgrade/);
});

test('accepts at and above the minimum, warning honestly about untested releases', t => {
	for (const version of [
		MIN_NANOCODER_VERSION,
		'1.32.1',
		'1.33.0',
		'2.0.0',
		'1.32.0+build.1',
	]) {
		const policy = versionPolicy(version);
		t.is(policy.status, 'untested');
		t.regex(policy.reason ?? '', /Compatibility is unverified/);
	}
});

test('fails closed on missing, malformed, pre-release and unsafe numeric versions', t => {
	for (const version of [
		null,
		'',
		'1.32',
		'v1.32.0',
		'01.32.0',
		'1.32.0-alpha.1',
		'99999999999999999.0.0',
	]) {
		t.is(versionPolicy(version).status, 'refused');
	}
});

test('always accepts the exact main-owned bundled version', t => {
	t.deepEqual(versionPolicy('1.31.0', '1.31.0'), {
		status: 'bundled',
		version: '1.31.0',
		reason: null,
	});
	t.is(versionPolicy('1.30.0', '1.31.0').status, 'refused');
});
