import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {resolveNanocoder} from '@/main/nanocoder/runtime';
import {qaEnvironment} from './environment';

const runtime = {cliPath: '/fake/dist/cli.js', nodePath: '/chosen/node'};

test('QA reuses child environment safety and removes development renderer variants', t => {
	const inherited = {
		PATH: '/kept',
		UNSET: undefined,
		node_options: '--require=untrusted',
		Electron_Run_As_Node: '1',
		nAnOcOdEr_TrUsT_dIrEcToRy: '1',
		electron_renderer_url: 'http://not-the-built-app',
	};
	const before = {...inherited};
	t.deepEqual(qaEnvironment(inherited, runtime), {
		PATH: '/kept',
		NANOCODER_DESKTOP_CLI: runtime.cliPath,
		NANOCODER_DESKTOP_NODE: runtime.nodePath,
	});
	t.deepEqual(inherited, before);
});

for (const [cliKey, nodeKey] of [
	['NANOCODER_DESKTOP_CLI', 'NANOCODER_DESKTOP_NODE'],
	['nanocoder_desktop_cli', 'nanocoder_desktop_node'],
	['NanoCoder_DESKTOP_Cli', 'nanocoder_Desktop_NODE'],
]) {
	test(`QA refuses inherited runtime overrides named ${cliKey} and ${nodeKey}`, async t => {
		const work = realpathSync.native(
			mkdtempSync(path.join(tmpdir(), 'nd-qa-env-')),
		);
		t.teardown(() => rmSync(work, {recursive: true, force: true}));
		mkdirSync(path.join(work, 'dist'));
		const cliPath = path.join(work, 'dist/cli.js');
		writeFileSync(cliPath, '');
		writeFileSync(
			path.join(work, 'package.json'),
			JSON.stringify({
				name: '@nanocollective/nanocoder',
				version: '9.9.9',
				bin: {nanocoder: 'dist/cli.js'},
			}),
		);
		const env = qaEnvironment(
			{
				[cliKey]: path.join(work, 'not-the-fixture/dist/cli.js'),
				[nodeKey]: path.join(work, 'untrusted-node'),
			},
			{cliPath, nodePath: process.execPath},
		);
		t.deepEqual(Object.keys(env), [
			'NANOCODER_DESKTOP_CLI',
			'NANOCODER_DESKTOP_NODE',
		]);
		const resolved = await resolveNanocoder({
			env,
			platform: process.platform,
			untrustedRoots: [],
		});
		t.true(resolved.ok);
		if (resolved.ok) {
			t.is(resolved.runtime.cliPath, cliPath);
			t.is(resolved.runtime.nodePath, realpathSync(process.execPath));
		}
	});
}
