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

// The pinned archive for this machine, or a clear refusal.
export function pinnedArchive(pin, platform, arch) {
	const key = platformKey(platform, arch);
	const archive = pin.archives[key];
	if (!archive) throw new Error(`Nothing is pinned for ${key}`);
	return {key, archive};
}

// What the measurement passes on: the user's environment without the variables that change how
// Node loads code, so each runtime is measured the way the desktop launches it.
export function measurementEnv(source, extra = {}) {
	const dropped = new Set(['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'NODE_ENV']);
	return {
		...Object.fromEntries(
			Object.entries(source).filter(
				([name]) => !dropped.has(name.toUpperCase()),
			),
		),
		...extra,
	};
}

// Reads one line from Nanocoder's stdout. 'ignore' is anything that is not the answer to
// initialize (id 0); an error answer is a failure, never a good run.
export function classifyInitializeReply(line) {
	let frame;
	try {
		frame = JSON.parse(line);
	} catch {
		return {kind: 'failed', reason: 'stdout was not ACP'};
	}
	if (typeof frame !== 'object' || frame === null || frame.id !== 0) {
		return {kind: 'ignore'};
	}
	if (frame.error) {
		const message = String(frame.error.message ?? 'unknown error').slice(
			0,
			120,
		);
		return {kind: 'failed', reason: `initialize returned an error: ${message}`};
	}
	return frame.result && typeof frame.result === 'object'
		? {kind: 'answered'}
		: {kind: 'failed', reason: 'initialize returned no result'};
}

const fmt = summary =>
	summary
		? `${summary.median.toFixed(0)} (${summary.min.toFixed(0)} to ${summary.max.toFixed(0)})`
		: 'n/a';

export function formatReport(report, version) {
	const outcome = ({valid, ok, reason}) =>
		valid === false
			? 'not testable here, a system Node is on the minimal PATH'
			: ok
				? 'starts'
				: `fails (${reason})`;
	return [
		`### Runtime measurement, ${report.platform}`,
		'',
		'| Runtime | Node | Startup ms, median (range) | Idle memory MB, median (range) | Failures |',
		'|---|---|---|---|---|',
		...report.runtimes.map(
			r =>
				`| ${r.name} | ${r.node} | ${fmt(r.startupMs)} | ${fmt(r.residentMb)} | ${r.failures} of ${r.runs}${r.failureReasons.length ? `: ${r.failureReasons.join('; ')}` : ''} |`,
		),
		'',
		`Sidecar binary: ${formatMb(report.sidecar.binaryBytes)} unpacked (${version}).`,
		'',
		...Object.entries(report.noNodeOnPath).map(
			([name, result]) => `- ${name} without Node on PATH: ${outcome(result)}`,
		),
		...(report.hardenedRuntime
			? [
					'',
					'Hardened runtime, sidecar signed ad hoc:',
					...report.hardenedRuntime.map(
						o => `- ${o.label}: ${outcome({ok: o.ok, reason: o.reason})}`,
					),
				]
			: []),
		'',
	].join('\n');
}
