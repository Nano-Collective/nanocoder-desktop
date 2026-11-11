import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundledLayout} from './lib/bundle.mjs';

// The absolute path of the Nanocoder that `pnpm prepare:runtime` staged, for the ACP conformance run (ACP-21).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(
	path.join(root, '.cache', 'runtime', ...bundledLayout(process.platform).cli),
);
