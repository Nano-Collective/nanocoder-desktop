import {readFileSync} from 'node:fs';
import path from 'node:path';

const REGISTRY = 'https://registry.npmjs.org/';

// Relative to the runtime folder inside the app's resources, for the resolver and the staging script.
export function bundledLayout(platform) {
	return {
		node: ['node', platform === 'win32' ? 'node.exe' : 'node'],
		cli: [
			'nanocoder',
			'node_modules',
			'@nanocollective',
			'nanocoder',
			'dist',
			'cli.js',
		],
	};
}

// Throws unless the lock names exactly the pinned Nanocoder tarball and every package comes from the registry with a hash.
export function verifyBundleLock(lock, pin) {
	const packages = lock.packages ?? {};
	const wanted = packages[''].dependencies?.[pin.package];
	if (wanted !== pin.version)
		throw new Error(
			`${pin.package} must be an exact version ${pin.version} in bundle/nanocoder/package.json, found ${wanted}`,
		);
	const entry = packages[`node_modules/${pin.package}`];
	if (!entry) throw new Error(`${pin.package} is not in the lock`);
	if (entry.version !== pin.version)
		throw new Error(
			`The lock has ${pin.package} ${entry.version}, but ${pin.version} is pinned (version)`,
		);
	if (entry.integrity !== pin.integrity)
		throw new Error(
			`The lock's integrity for ${pin.package} does not match the pinned tarball hash (integrity)`,
		);
	for (const [name, item] of Object.entries(packages)) {
		if (name === '' || item.link) continue;
		if (!item.integrity)
			throw new Error(`${name} has no integrity hash in the lock`);
		if (!String(item.resolved ?? '').startsWith(REGISTRY))
			throw new Error(`${name} does not come from the npm registry`);
	}
}

// Throws unless the folder holds the pinned Nanocoder; returns the path of its cli.
export function verifyInstalledNanocoder(root, pin) {
	const dir = path.join(root, 'node_modules', ...pin.package.split('/'));
	const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
	if (pkg.name !== pin.package)
		throw new Error(
			`Installed package name is ${pkg.name}, not ${pin.package}`,
		);
	if (pkg.version !== pin.version)
		throw new Error(
			`Installed ${pin.package} is ${pkg.version}, but ${pin.version} is pinned`,
		);
	const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.nanocoder;
	const cli = path.resolve(dir, 'dist', 'cli.js');
	if (typeof bin !== 'string' || path.resolve(dir, bin) !== cli)
		throw new Error(
			'The installed package has no dist/cli.js as its bin (cli)',
		);
	return cli;
}
