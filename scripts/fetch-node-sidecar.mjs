import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {nodeBinaryPath, pinnedArchive, verifyArchive} from './lib/runtime.mjs';

// Downloads the pinned Node and checks it against the checksum pinned in node-sidecar.json,
// which came from the official SHASUMS256.txt. To move the pin, take the new hashes from the
// release's signed SHASUMS256.txt and change the version in the same pull request.
const pin = JSON.parse(
	readFileSync(new URL('./node-sidecar.json', import.meta.url), 'utf8'),
);
const cacheDir = path.resolve('.cache', 'node-sidecar');
const {key, archive} = pinnedArchive(pin, process.platform, process.arch);

const binary = nodeBinaryPath(cacheDir, pin.version, key, process.platform);
if (!existsSync(binary)) {
	mkdirSync(cacheDir, {recursive: true});
	const file = path.join(cacheDir, archive.file);
	const response = await fetch(`${pin.source}/${pin.version}/${archive.file}`);
	if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
	await writeFile(file, Buffer.from(await response.arrayBuffer()));
	try {
		await verifyArchive(file, archive.sha256);
	} catch (error) {
		rmSync(file, {force: true});
		throw error;
	}
	// Windows ships a tar that reads zip files; Git's tar on PATH may not.
	const tar =
		process.platform === 'win32'
			? path.join(
					process.env.SystemRoot ?? 'C:\\Windows',
					'System32',
					'tar.exe',
				)
			: 'tar';
	execFileSync(tar, ['-xf', file, '-C', cacheDir]);
	console.error(`Archive: ${statSync(file).size} bytes`);
	rmSync(file, {force: true});
}
console.log(binary);
