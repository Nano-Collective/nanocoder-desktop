import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
	bundledLayout,
	verifyBundleLock,
	verifyInstalledNanocoder,
	verifyNanocoderLicence,
} from './lib/bundle.mjs';

// Stages the runtime a packaged app runs Nanocoder with: the pinned Node (checksum verified by
// fetch-node-sidecar.mjs) and the pinned Nanocoder with its locked production dependencies
// (REL-02, REL-04, REL-11). electron-builder copies the folder into the app's resources.
const root = path.resolve(import.meta.dirname, '..');
const stage = path.join(root, '.cache', 'runtime');
const bundleDir = path.join(root, 'bundle', 'nanocoder');
const read = file => readFileSync(file, 'utf8');
const pin = JSON.parse(
	read(path.join(root, 'scripts', 'nanocoder-bundle.json')),
);
const lockText = read(path.join(bundleDir, 'package-lock.json'));
const packageText = read(path.join(bundleDir, 'package.json'));

// Refused before anything is installed, so a mismatched lock never reaches a build.
verifyBundleLock(JSON.parse(lockText), pin);

const layout = bundledLayout(process.platform);
const nodeTarget = path.join(stage, ...layout.node);
const cliTarget = path.join(stage, ...layout.cli);
const stamp = createHash('sha256')
	.update(read(path.join(root, 'scripts', 'node-sidecar.json')))
	.update(JSON.stringify(pin))
	.update(lockText)
	.update(packageText)
	.update(read(path.join(root, 'scripts', 'generate-notices.mjs')))
	.update(read(path.join(root, 'scripts', 'lib', 'notices.mjs')))
	.update(read(path.join(root, 'scripts', 'notice-policy.json')))
	.update(`${process.platform}-${process.arch}`)
	.digest('hex');
const stampFile = path.join(stage, '.stamp');
if (
	existsSync(stampFile) &&
	read(stampFile) === stamp &&
	existsSync(nodeTarget) &&
	existsSync(cliTarget) &&
	existsSync(path.join(stage, 'THIRD-PARTY-NOTICES.txt'))
) {
	console.log(`Runtime already staged in ${stage}`);
	process.exit(0);
}

rmSync(stage, {recursive: true, force: true});
mkdirSync(path.dirname(nodeTarget), {recursive: true});

const nodeSource = execFileSync(
	process.execPath,
	[path.join(root, 'scripts', 'fetch-node-sidecar.mjs')],
	{cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']},
).trim();
copyFileSync(nodeSource, nodeTarget);
chmodSync(nodeTarget, 0o755);
// The Node licence travels with the binary it covers (REL-06).
const nodeHome =
	process.platform === 'win32'
		? path.dirname(nodeSource)
		: path.resolve(nodeSource, '..', '..');
copyFileSync(
	path.join(nodeHome, 'LICENSE'),
	path.join(stage, 'node', 'LICENSE'),
);

const nanocoderDir = path.join(stage, 'nanocoder');
mkdirSync(nanocoderDir, {recursive: true});
writeFileSync(path.join(nanocoderDir, 'package.json'), packageText);
writeFileSync(path.join(nanocoderDir, 'package-lock.json'), lockText);
// Scripts stay off: nothing in the tree needs one, and an install script would run unreviewed code at build time.
execFileSync(
	process.platform === 'win32' ? 'npm.cmd' : 'npm',
	[
		'ci',
		'--omit=dev',
		'--ignore-scripts',
		'--no-audit',
		'--no-fund',
		'--loglevel=error',
	],
	{cwd: nanocoderDir, stdio: 'inherit', shell: process.platform === 'win32'},
);
verifyInstalledNanocoder(nanocoderDir, pin);
verifyNanocoderLicence(nanocoderDir, pin);
// The notices for exactly what was just staged (REL-06); the build fails on a licence outside the policy.
execFileSync(
	process.execPath,
	[path.join(root, 'scripts', 'generate-notices.mjs'), '--runtime'],
	{cwd: root, stdio: 'inherit'},
);
writeFileSync(stampFile, stamp);
console.log(`Staged Node and ${pin.package} ${pin.version} in ${stage}`);
