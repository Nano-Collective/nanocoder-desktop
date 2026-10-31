import {resolve} from 'node:path';
import {defineConfig} from 'electron-vite';

const fromRoot = (...parts: string[]) => resolve(import.meta.dirname, ...parts);
const alias = {'@': fromRoot('source')};

export default defineConfig({
	main: {
		resolve: {alias},
		build: {
			rolldownOptions: {
				input: {index: fromRoot('source/main/index.ts')},
			},
		},
	},
	preload: {
		resolve: {alias},
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
