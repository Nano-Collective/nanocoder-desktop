import {existsSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {trustDirectory, trustRefusal} from '@/main/nanocoder/trust';

const tail =
	' Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.';

test.after.always(removeFakeProjects);

test("reads each of Nanocoder's trust refusals", t => {
	t.deepEqual(trustRefusal(`Directory ~/a b.c is not trusted.${tail}`), {
		reason: 'not-trusted',
		summary: 'Directory ~/a b.c is not trusted.',
	});
	t.deepEqual(
		trustRefusal(`Directory C:\\work changed since you trusted it.${tail}`),
		{
			reason: 'changed',
			summary: 'Directory C:\\work changed since you trusted it.',
		},
	);
	t.deepEqual(
		trustRefusal(`Directory /p needs re-approval after the upgrade.${tail}`),
		{
			reason: 'needs-re-approval',
			summary: 'Directory /p needs re-approval after the upgrade.',
		},
	);
});

test('does not mistake other startup failures for a trust refusal', t => {
	t.is(
		trustRefusal(
			'ACP initialization failed: No providers configured. Run nanocoder interactively to set them up.',
		),
		undefined,
	);
	t.is(trustRefusal('Directory listing is not trusted'), undefined);
});

test('the trust launch lets Nanocoder save the folder, then ends', async t => {
	const root = fakeProject('untrusted');
	await trustDirectory({runtime: fakeRuntime, root});
	t.true(existsSync(path.join(root, '.fake-trusted')));
});

test('the trust launch stops a Nanocoder that does not exit', async t => {
	await trustDirectory({
		runtime: fakeRuntime,
		root: fakeProject('hang'),
		timeoutMs: 200,
	});
	t.pass();
});
