const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function releaseDecision({version, exists}) {
	if (!VERSION.test(version))
		throw new Error(`"${version}" is not a valid version`);
	const tag = `v${version}`;
	const prerelease = version.includes('-');
	if (version === '0.0.0')
		return {
			release: false,
			prerelease,
			tag,
			reason: 'the version has never been versioned by a changeset release',
		};
	if (exists)
		return {
			release: false,
			prerelease,
			tag,
			reason: `${tag} already has a release`,
		};
	return {
		release: true,
		prerelease,
		tag,
		reason: `${tag} has no release yet`,
	};
}

export function checksumFile(entries) {
	for (const {name, sha256} of entries) {
		if (!SHA256.test(sha256))
			throw new Error(`${name} has no valid SHA-256 digest`);
		if (!SAFE_NAME.test(name))
			throw new Error(`"${name}" is not a plain file name`);
	}
	return [...entries]
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.map(({name, sha256}) => `${sha256}  ${name}\n`)
		.join('');
}

export function extractChangelog(changelog, version) {
	const lines = changelog.split('\n');
	const start = lines.findIndex(line => line.trim() === `# ${version}`);
	const body = [];
	if (start !== -1) {
		for (const line of lines.slice(start + 1)) {
			if (/^#{1,2} \d/.test(line)) break;
			body.push(line);
		}
	}
	const text = body.join('\n').trim();
	if (!text) throw new Error(`no changelog entry for ${version}`);
	return text;
}

export function releaseNotes({version, prerelease, changelog}) {
	const parts = [];
	if (prerelease)
		parts.push(
			'> **Pre-v0.1.** Nanocoder Desktop is being built in the open. Stability is not promised, and anything here can change.',
		);
	parts.push(
		[
			'## Before you install',
			'',
			'These installers are not signed or notarised yet, so macOS and Windows will warn before they open. Check each download against `SHA256SUMS.txt` before you run it.',
		].join('\n'),
	);
	parts.push(`## Changes in ${version}\n\n${changelog}`);
	return `${parts.join('\n\n')}\n`;
}
