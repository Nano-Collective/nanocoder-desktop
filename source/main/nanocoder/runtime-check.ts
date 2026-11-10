import {execFile} from 'node:child_process';
import {existsSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {launchNanocoder} from '@/main/nanocoder/launch';
import {bundledRuntimePaths, resolveNanocoder} from '@/main/nanocoder/runtime';
import type {NanocoderRuntime} from '@/shared/ipc';

export type RuntimeCheck =
	| {
			ok: true;
			source: NanocoderRuntime['source'];
			version: string;
			nodeVersion: string;
			// The poisoned NODE_OPTIONS did run when handed to Node directly, so its absence below means something.
			poisonControl: boolean;
	  }
	| {ok: false; reason: string};

const TIMEOUT_MS = 30_000;

type Launch = (
	runtime: Pick<NanocoderRuntime, 'nodePath' | 'cliPath'>,
	args: readonly string[],
	cwd: string,
	env?: NodeJS.ProcessEnv,
) => ReturnType<typeof launchNanocoder>;

// The packaged-app smoke test (REL-02, REL-04, SEC-05): the app finds the Node and Nanocoder it ships,
// runs them, and its launcher does not pass NODE_OPTIONS on.
export async function checkPackagedRuntime(options: {
	resourcesPath: string;
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	workDir: string;
	launch?: Launch;
}): Promise<RuntimeCheck> {
	const resolved = await resolveNanocoder({
		env: options.env,
		platform: options.platform,
		untrustedRoots: [],
		bundled: bundledRuntimePaths(options.resourcesPath, options.platform),
	});
	if (!resolved.ok) return {ok: false, reason: resolved.message};
	const {runtime} = resolved;
	if (runtime.source !== 'bundled')
		return {
			ok: false,
			reason: `The runtime came from the ${runtime.source}, not the bundle`,
		};

	const marker = path.join(options.workDir, 'poison-ran');
	const poison = path.join(options.workDir, 'poison.cjs');
	writeFileSync(
		poison,
		`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`,
	);
	const poisoned = {
		...options.env,
		NODE_OPTIONS: `--require ${JSON.stringify(poison)}`,
	};
	rmSync(marker, {force: true});
	await promisify(execFile)(runtime.nodePath, ['-e', '0'], {
		env: poisoned,
		timeout: TIMEOUT_MS,
		windowsHide: true,
	});
	const poisonControl = existsSync(marker);
	rmSync(marker, {force: true});

	const child = (options.launch ?? launchNanocoder)(
		runtime,
		['--version'],
		options.workDir,
		poisoned,
	);
	const output = await new Promise<string>((resolve, reject) => {
		let text = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('timeout'));
		}, TIMEOUT_MS);
		child.stdout.on('data', chunk => {
			text += String(chunk);
		});
		child.once('error', reject);
		child.once('close', code => {
			clearTimeout(timer);
			code === 0 ? resolve(text) : reject(new Error(`exit ${code}`));
		});
	}).catch(() => undefined);
	if (output === undefined)
		return {ok: false, reason: 'The bundled Nanocoder did not run'};
	if (output.trim() !== runtime.version)
		return {
			ok: false,
			reason: `The bundled Nanocoder reported ${output.trim()}, not ${runtime.version}`,
		};
	if (existsSync(marker))
		return {
			ok: false,
			reason: 'NODE_OPTIONS reached the bundled Node, so its script ran',
		};
	if (!poisonControl)
		return {
			ok: false,
			reason: 'The NODE_OPTIONS check could not show that the script runs',
		};
	return {
		ok: true,
		source: runtime.source,
		version: runtime.version,
		nodeVersion: runtime.nodeVersion,
		poisonControl,
	};
}
