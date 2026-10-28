import {childEnv} from '@/main/nanocoder/launch';
import type {NanocoderRuntime} from '@/shared/ipc';

const QA_OVERRIDES = new Set([
	'ELECTRON_RENDERER_URL',
	'NANOCODER_DESKTOP_CLI',
	'NANOCODER_DESKTOP_NODE',
]);

export function qaEnvironment(
	inherited: NodeJS.ProcessEnv,
	runtime: Pick<NanocoderRuntime, 'cliPath' | 'nodePath'>,
): Record<string, string> {
	const clean = Object.fromEntries(
		Object.entries(childEnv(inherited)).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined && !QA_OVERRIDES.has(entry[0].toUpperCase()),
		),
	);
	return {
		...clean,
		NANOCODER_DESKTOP_CLI: runtime.cliPath,
		NANOCODER_DESKTOP_NODE: runtime.nodePath,
	};
}
