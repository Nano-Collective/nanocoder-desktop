import {execFileSync, spawnSync} from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Installs the installer this platform's build made, launches the installed app, uninstalls it, and checks
// nothing is left behind (REL-05, phase 4.2). It changes the machine it runs on, so it is meant for CI.
const release = path.resolve('release');
const work = mkdtempSync(path.join(tmpdir(), 'nd-installer-'));
const log = message => console.log(`[installer] ${message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function artefact(pattern) {
	const found = readdirSync(release).find(name => pattern.test(name));
	if (!found) throw new Error(`No installer matching ${pattern} in ${release}`);
	return path.join(release, found);
}

// Starts the installed app in smoke-test mode and checks it used its own bundled runtime.
function launch(executable) {
	const result = path.join(work, `launch-${Date.now()}.json`);
	const run = spawnSync(
		executable,
		['--smoke-test', `--smoke-result=${result}`],
		{stdio: 'inherit', timeout: 120_000},
	);
	if (run.error || run.status !== 0)
		throw new Error(
			`The installed app failed to start: ${run.error?.message ?? `exit code ${run.status}`}`,
		);
	const check = JSON.parse(readFileSync(result, 'utf8'));
	if (!check.ok || check.source !== 'bundled')
		throw new Error(
			`The installed app did not use its bundle: ${JSON.stringify(check)}`,
		);
	log(
		`launched, bundled Nanocoder ${check.version}, idle memory ${check.idleMemoryMb} MB`,
	);
}

async function gone(target, what) {
	for (let attempt = 0; attempt < 120; attempt++) {
		if (!existsSync(target)) return;
		await sleep(500);
	}
	throw new Error(`${what} is still there after uninstalling: ${target}`);
}

async function linux() {
	const deb = artefact(/\.deb$/);
	const sudo = (...args) => execFileSync('sudo', args, {stdio: 'inherit'});
	// apt installs the package's dependencies, as it does for a user; dpkg -i alone would not.
	sudo('apt-get', 'install', '-y', deb);
	let installed = false;
	try {
		installed = true;
		// The package registers this command, which resolves to the installed executable.
		const command = '/usr/bin/nanocoder-desktop';
		if (!existsSync(command))
			throw new Error(`The package did not install ${command}`);
		const executable = realpathSync(command);
		const folder = path.dirname(executable);
		launch(executable);
		sudo('dpkg', '-r', 'nanocoder-desktop');
		installed = false;
		await gone(folder, 'The install folder');
		await gone(command, 'The command');
		log('uninstalled, install folder and command removed');
	} finally {
		if (installed) spawnSync('sudo', ['dpkg', '-r', 'nanocoder-desktop']);
	}
}

async function darwin() {
	const dmg = artefact(/\.dmg$/);
	const mount = path.join(work, 'mount');
	const installTo = path.join(work, 'Applications');
	mkdirSync(mount);
	mkdirSync(installTo);
	execFileSync(
		'hdiutil',
		['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg],
		{
			stdio: 'inherit',
		},
	);
	let app;
	try {
		const bundle = readdirSync(mount).find(name => name.endsWith('.app'));
		if (!bundle) throw new Error('The disk image holds no app');
		app = path.join(installTo, bundle);
		cpSync(path.join(mount, bundle), app, {
			recursive: true,
			verbatimSymlinks: true,
		});
	} finally {
		execFileSync('hdiutil', ['detach', mount, '-force'], {stdio: 'inherit'});
	}
	const macos = path.join(app, 'Contents', 'MacOS');
	launch(path.join(macos, readdirSync(macos)[0]));
	rmSync(app, {recursive: true, force: true});
	if (existsSync(app))
		throw new Error('The app is still there after deleting it');
	// The image was detached above; confirm the system no longer lists it.
	if (execFileSync('hdiutil', ['info'], {encoding: 'utf8'}).includes(mount))
		throw new Error('The disk image is still mounted');
	log('removed by deleting the app, as a user does; no image left mounted');
}

async function windows() {
	const setup = artefact(/\.exe$/);
	const programs = path.join(process.env.LOCALAPPDATA ?? '', 'Programs');
	const before = new Set(existsSync(programs) ? readdirSync(programs) : []);
	const install = spawnSync(setup, ['/S'], {
		stdio: 'inherit',
		timeout: 300_000,
	});
	if (install.error || install.status !== 0)
		throw new Error(
			`The installer failed: ${install.error?.message ?? `exit code ${install.status}`}`,
		);
	const added = readdirSync(programs).filter(name => !before.has(name));
	const folder = added
		.map(name => path.join(programs, name))
		.find(dir =>
			readdirSync(dir).some(file => /^Nanocoder Desktop\.exe$/i.test(file)),
		);
	if (!folder)
		throw new Error(`No new install under ${programs}: ${added.join(', ')}`);
	launch(path.join(folder, 'Nanocoder Desktop.exe'));
	const uninstaller = readdirSync(folder).find(file =>
		/^Uninstall .*\.exe$/i.test(file),
	);
	if (!uninstaller) throw new Error('The install has no uninstaller');
	// The uninstaller copies itself and returns at once, so wait for the folder to go.
	spawnSync(path.join(folder, uninstaller), ['/S'], {
		stdio: 'inherit',
		timeout: 120_000,
	});
	await gone(folder, 'The install folder');
	log('uninstalled, install folder removed');
}

try {
	const run = {linux, darwin, win32: windows}[process.platform];
	if (!run) throw new Error(`No installer test for ${process.platform}`);
	await run();
	console.log('Installer installed, launched and uninstalled cleanly');
} catch (error) {
	console.error(`Installer smoke test failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	rmSync(work, {recursive: true, force: true});
}
