import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
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

// The resources folder of an app, from the path of its executable.
export function resourcesOf(executable, platform) {
	return platform === 'darwin'
		? path.resolve(executable, '..', '..', 'Resources')
		: path.join(path.dirname(executable), 'resources');
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

// MIT asks for the notice to travel with the code, so the build fails if the package has lost its own.
export function verifyNanocoderLicence(root, pin) {
	const dir = path.join(root, 'node_modules', ...pin.package.split('/'));
	const name = existsSync(dir)
		? readdirSync(dir).find(file => /^licen[cs]e(\.|$)/i.test(file))
		: undefined;
	if (!name) throw new Error(`${pin.package} has no licence file`);
	const file = path.join(dir, name);
	if (statSync(file).size === 0)
		throw new Error(`The licence file of ${pin.package} is empty`);
	return file;
}

// [name, version] for every installed package in a lock, whatever its depth.
export function packageNames(lock) {
	return Object.entries(lock.packages ?? {}).flatMap(([key, item]) => {
		if (key === '' || item.link) return [];
		return [[key.split('node_modules/').pop(), item.version]];
	});
}

// Locked versions published within the last `minDays` days, the age gate pnpm applies to the desktop's own dependencies.
// `times` maps a package name to its registry publish times by version; names starting with an `exempt` prefix are skipped.
export function youngPackages(lock, times, now, minDays, exempt) {
	const young = [];
	const unknown = [];
	for (const [name, version] of packageNames(lock)) {
		if (exempt.some(prefix => name.startsWith(prefix))) continue;
		const published = times[name]?.[version];
		if (!published) {
			unknown.push(`${name}@${version}`);
			continue;
		}
		const days = Math.floor((now - new Date(published)) / 86_400_000);
		if (days < minDays) young.push({name, version, days});
	}
	return {young, unknown};
}
