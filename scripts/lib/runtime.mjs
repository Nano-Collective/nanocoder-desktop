import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';

const OS_NAMES = {darwin: 'darwin', linux: 'linux', win32: 'win'};

// The key used in node-sidecar.json, for example "darwin-arm64".
export function platformKey(platform, arch) {
	const os = OS_NAMES[platform];
	if (!os) throw new Error(`No Node sidecar for platform ${platform}`);
	return `${os}-${arch}`;
}

export function nodeBinaryPath(cacheDir, version, key, platform) {
	const root = path.join(cacheDir, `node-${version}-${key}`);
	return platform === 'win32'
		? path.join(root, 'node.exe')
		: path.join(root, 'bin', 'node');
}

export function sha256File(file) {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		createReadStream(file)
			.on('data', chunk => hash.update(chunk))
			.on('error', reject)
			.on('end', () => resolve(hash.digest('hex')));
	});
}

// Throws unless the file is exactly the archive that was pinned.
export async function verifyArchive(file, expectedSha256) {
	const actual = await sha256File(file);
	if (actual !== expectedSha256) {
		throw new Error(
			`Checksum mismatch: expected ${expectedSha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...`,
		);
	}
}

export function median(values) {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarise(values) {
	if (values.length === 0) return undefined;
	return {
		min: Math.min(...values),
		median: median(values),
		max: Math.max(...values),
	};
}

// `ps -o rss=` prints kilobytes; `tasklist /FO CSV /NH` prints a quoted "40,000 K" working set.
export function parseResidentKb(output, platform) {
	const field =
		platform === 'win32' ? (output.split('","')[4] ?? '') : output.trim();
	const digits = field.replace(/\D/g, '');
	return digits === '' ? undefined : Number(digits);
}

export const formatMb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
