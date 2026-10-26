import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';

const release = path.resolve('release');

function findExecutable() {
	if (process.platform === 'linux') {
		return path.join(release, 'linux-unpacked', 'nanocoder-desktop');
	}
	if (process.platform === 'win32') {
		const dir = path.join(release, 'win-unpacked');
		const exes = readdirSync(dir).filter(name => name.endsWith('.exe'));
		const named = exes.find(name =>
			/^(nanocoder-desktop|Nanocoder Desktop)\.exe$/.test(name),
		);
		return path.join(dir, named ?? exes[0] ?? 'missing.exe');
	}
	const app = readdirSync(release, {withFileTypes: true})
		.filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
		.flatMap(entry =>
			readdirSync(path.join(release, entry.name))
				.filter(name => name.endsWith('.app'))
				.map(name => path.join(release, entry.name, name)),
		)[0];
	if (!app) {
		return path.join(release, 'missing.app');
	}
	const binDir = path.join(app, 'Contents', 'MacOS');
	return path.join(binDir, readdirSync(binDir)[0] ?? 'missing');
}

const executable = findExecutable();
if (!existsSync(executable)) {
	console.error(`Packaged app not found: ${executable}`);
	process.exit(1);
}

console.log(`Launching ${executable}`);
const result = spawnSync(executable, ['--smoke-test'], {
	stdio: 'inherit',
	timeout: 120_000,
});

if (result.error || result.status !== 0) {
	console.error(
		`Smoke test failed: ${result.error?.message ?? `exit code ${result.status}`}`,
	);
	process.exit(1);
}
console.log('Packaged app started and exited cleanly');
