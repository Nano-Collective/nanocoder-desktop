import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'electron-vite';

const fromRoot = (...parts: string[]) => resolve(import.meta.dirname, ...parts);
const alias = {'@': fromRoot('source')};

// Records every module a build bundles, so the notices can list exactly the packages that ship (REL-06).
const recordModules = (name: string) => ({
	name: `record-modules-${name}`,
	generateBundle(
		_options: unknown,
		bundle: Record<
			string,
			{type: string; moduleIds?: string[]; modules?: Record<string, unknown>}
		>,
	) {
		const ids = new Set<string>();
		for (const chunk of Object.values(bundle))
			if (chunk.type === 'chunk')
				for (const id of chunk.moduleIds ?? Object.keys(chunk.modules ?? {}))
					ids.add(id);
		mkdirSync(fromRoot('.cache', 'bundled-modules'), {recursive: true});
		writeFileSync(
			fromRoot('.cache', 'bundled-modules', `${name}.json`),
			JSON.stringify([...ids].sort(), null, 1),
		);
	},
});

export default defineConfig({
	main: {
		resolve: {alias},
		plugins: [recordModules('main')],
		build: {
			rolldownOptions: {
				input: {
					index: fromRoot('source/main/index.ts'),
					'pty-worker': fromRoot('source/main/terminal/pty-worker.ts'),
				},
			},
		},
	},
	preload: {
		resolve: {alias},
		plugins: [recordModules('preload')],
		build: {
			rolldownOptions: {
				input: {index: fromRoot('source/preload/index.ts')},
				// Sandboxed preloads must be CommonJS.
				output: {format: 'cjs', entryFileNames: '[name].cjs'},
			},
		},
	},
	renderer: {
		root: fromRoot('source/renderer'),
		resolve: {alias},
		plugins: [recordModules('renderer')],
		oxc: {jsx: {runtime: 'automatic'}},
		build: {
			outDir: fromRoot('out/renderer'),
			assetsInlineLimit: 0,
			rolldownOptions: {
				input: {index: fromRoot('source/renderer/index.html')},
			},
		},
	},
});
