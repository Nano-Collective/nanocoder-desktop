// The Electron fuses the shipped build sets (SEC-19). `index` is the fuse's place in the fuse wire,
// `enforce` marks the ones a packaged-build test fails on, and `reason` is what the release doc records.
export const FUSE_POLICY = {
	runAsNode: {
		index: 0,
		enabled: false,
		enforce: true,
		reason:
			'Nothing needs Electron as a Node runtime: Nanocoder runs under the bundled Node (DEC-38). Off stops ELECTRON_RUN_AS_NODE turning the app into a script runner.',
	},
	enableCookieEncryption: {
		index: 1,
		enabled: false,
		enforce: false,
		reason:
			'Left off for now: on macOS it asks for Keychain access, which wants the signed app of phase 4.4. Revisit there.',
	},
	enableNodeOptionsEnvironmentVariable: {
		index: 2,
		enabled: false,
		enforce: true,
		reason:
			'Off, so NODE_OPTIONS in the environment cannot make the app load extra code.',
	},
	enableNodeCliInspectArguments: {
		index: 3,
		enabled: false,
		enforce: true,
		reason:
			'Off, so --inspect cannot attach a debugger to the shipped app. End-to-end tests drive an unpacked app, where it stays on.',
	},
	enableEmbeddedAsarIntegrityValidation: {
		index: 4,
		enabled: true,
		enforce: true,
		reason:
			'On, so a changed app.asar is refused on macOS and Windows. Electron does not validate it on Linux.',
	},
	onlyLoadAppFromAsar: {
		index: 5,
		enabled: true,
		enforce: true,
		reason:
			'On, so the app cannot be swapped for a folder of files. It already ships as an asar; native addons stay unpacked beside it.',
	},
	loadBrowserProcessSpecificV8Snapshot: {
		index: 6,
		enabled: false,
		enforce: false,
		reason: 'Not used: no custom snapshot is built.',
	},
	grantFileProtocolExtraPrivileges: {
		index: 7,
		enabled: false,
		enforce: true,
		reason:
			'Off: the app loads its own app:// scheme and never a file:// page, so file pages get no extra privileges.',
	},
};

// The options electron-builder takes under `electronFuses`.
export function wireOf(policy) {
	return Object.fromEntries(
		Object.entries(policy).map(([name, {enabled}]) => [name, enabled]),
	);
}

const STATES = {48: 'off', 49: 'on', 114: 'removed'};

// What is wrong with a fuse wire read from a packaged executable; empty means it meets the policy.
export function fuseViolations(wire) {
	if (!wire) return ['No fuse wire could be read'];
	if (wire.version !== '1')
		return [`The fuse wire is version ${wire.version}, not 1`];
	const violations = [];
	for (const [name, {index, enabled, enforce}] of Object.entries(FUSE_POLICY)) {
		if (!enforce) continue;
		const code = wire[index];
		const state =
			code === undefined ? 'missing' : (STATES[code] ?? `unknown (${code})`);
		const wanted = enabled ? 'on' : 'off';
		if (state !== wanted)
			violations.push(`${name} is ${state}, and must be ${wanted}`);
	}
	return violations;
}
