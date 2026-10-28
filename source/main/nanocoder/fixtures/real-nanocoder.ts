import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	type Reply,
	SCRIPTED_MODEL,
	startScriptedProvider,
} from '@/main/nanocoder/fixtures/scripted-provider';

// Helpers for the *.acp.ts tests, which run a real Nanocoder against a scripted model.
const cli = process.env.NANOCODER_CLI ?? '';
export const runtime = {nodePath: process.execPath, cliPath: cli};
export const clientInfo = {name: 'nanocoder-desktop', version: '0.0.0-test'};

export function requireCli(): void {
	if (!path.isAbsolute(cli)) {
		throw new Error('Set NANOCODER_CLI to the absolute path of dist/cli.js');
	}
}

export function createWorkFolder(prefix: string) {
	const work = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
	return {work, remove: () => rmSync(work, {recursive: true, force: true})};
}

// A project, a scripted model and a Nanocoder configuration that points at it.
export async function setupProject(
	work: string,
	name: string,
	script: Reply[],
) {
	const dir = path.join(work, name);
	const root = path.join(dir, 'project');
	mkdirSync(root, {recursive: true});
	const provider = await startScriptedProvider(script);
	const configDir = path.join(dir, 'config');
	mkdirSync(configDir);
	writeFileSync(
		path.join(configDir, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				providers: [
					{
						name: 'Scripted',
						baseUrl: provider.baseUrl,
						models: [SCRIPTED_MODEL],
					},
				],
			},
		}),
	);
	const env = {
		...process.env,
		NANOCODER_CONFIG_DIR: configDir,
		NANOCODER_DATA_DIR: path.join(dir, 'data'),
		// AVA sets NODE_ENV=test, which makes Nanocoder skip its global config.
		NODE_ENV: undefined,
	};
	return {root, provider, env};
}
