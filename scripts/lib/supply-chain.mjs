const SHA = /^[0-9a-f]{40}$/;
const INSTALL_SCRIPT_ALLOWED = ['electron', 'esbuild', 'node-pty'];

// Every `uses:` that points outside this repository, when it is not a full commit SHA (SEC-18).
export function unpinnedReferences(workflow) {
	const found = [];
	for (const line of workflow.split('\n')) {
		const match = /^\s*(?:-\s+)?uses:\s*([^\s#]+)/.exec(line);
		if (!match) continue;
		const reference = match[1];
		if (reference.startsWith('./') || reference.startsWith('docker://'))
			continue;
		const ref = reference.split('@')[1] ?? '';
		if (!SHA.test(ref)) found.push(reference);
	}
	return found;
}

export function pinnedElectron(manifest) {
	const version =
		manifest.devDependencies?.electron ?? manifest.dependencies?.electron;
	return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);
}

function topLevel(text, key) {
	const prefix = `${key}:`;
	for (const line of text.split('\n'))
		if (line.startsWith(prefix))
			return line.slice(prefix.length).trim().split(/\s+/)[0] || undefined;
	return undefined;
}

export function pnpmPolicyProblems(workspace) {
	const problems = [];
	if (!(Number(topLevel(workspace, 'minimumReleaseAge')) >= 10080))
		problems.push(
			'minimumReleaseAge must be at least 10080 minutes (seven days)',
		);
	if (topLevel(workspace, 'blockExoticSubdeps') !== 'true')
		problems.push('blockExoticSubdeps must be true');
	if (topLevel(workspace, 'trustPolicy') !== 'no-downgrade')
		problems.push('trustPolicy must be no-downgrade');
	const block = /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m.exec(workspace)?.[1] ?? '';
	for (const line of block.split('\n')) {
		const entry = /^\s+['"]?([^:'"]+)['"]?:\s*true\s*$/.exec(line);
		if (entry && !INSTALL_SCRIPT_ALLOWED.includes(entry[1]))
			problems.push(
				`${entry[1]} may not run install scripts: only ${INSTALL_SCRIPT_ALLOWED.join(', ')} may`,
			);
	}
	return problems;
}

// A workflow step that installs without `--frozen-lockfile` could change the lockfile in CI (SEC-18).
export function installProblems(workflow) {
	const found = [];
	for (const line of workflow.split('\n')) {
		const match = /run:\s*(pnpm (?:install|add|i)(?:\s[^#]*)?)$/.exec(line);
		if (match && !match[1].includes('--frozen-lockfile'))
			found.push(match[1].trim());
	}
	return found;
}
