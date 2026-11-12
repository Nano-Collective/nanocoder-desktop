import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {
	installProblems,
	pinnedElectron,
	pnpmPolicyProblems,
	unpinnedReferences,
} from './supply-chain.mjs';

const sha = 'a'.repeat(40);

test('SEC-18 an action or reusable workflow must be pinned to a full commit SHA', t => {
	const workflow = [
		`      - uses: actions/checkout@${sha}`,
		`      - uses: actions/checkout@${sha} # v4`,
		'      - uses: actions/setup-node@v4',
		'      - uses: actions/cache@main',
		'    uses: Nano-Collective/.github/.github/workflows/pr-checks.yml@main',
		'      - uses: ./local-action',
		'      - run: echo "uses: not/a-step@v1"',
	].join('\n');
	t.deepEqual(unpinnedReferences(workflow), [
		'actions/setup-node@v4',
		'actions/cache@main',
		'Nano-Collective/.github/.github/workflows/pr-checks.yml@main',
	]);
	t.deepEqual(
		unpinnedReferences(`      - uses: actions/checkout@${'g'.repeat(40)}`),
		[`actions/checkout@${'g'.repeat(40)}`],
	);
	t.deepEqual(
		unpinnedReferences(`      - uses: actions/checkout@${'a'.repeat(39)}`),
		[`actions/checkout@${'a'.repeat(39)}`],
	);
});

test('SEC-18 Electron must be one exact version, never a range or a tag', t => {
	t.true(pinnedElectron({devDependencies: {electron: '45.1.0'}}));
	for (const version of [
		'^45.1.0',
		'~45.1.0',
		'45',
		'45.x',
		'latest',
		'>=45.0.0',
		'45.1.0-beta.1',
	])
		t.false(pinnedElectron({devDependencies: {electron: version}}), version);
	t.false(pinnedElectron({devDependencies: {}}));
	t.true(pinnedElectron({dependencies: {electron: '45.1.0'}}));
});

test('SEC-18 the pnpm policy keeps the release age, no exotic sub-dependencies, no trust downgrade and a short build allow-list', t => {
	const good = [
		'minimumReleaseAge: 10080',
		'blockExoticSubdeps: true',
		'trustPolicy: no-downgrade',
		'allowBuilds:',
		'  electron: true',
		'  node-pty: true',
		'  esbuild: true',
		'  electron-winstaller: false',
	].join('\n');
	t.deepEqual(pnpmPolicyProblems(good), []);
	t.deepEqual(pnpmPolicyProblems(good.replace('10080', '60')), [
		'minimumReleaseAge must be at least 10080 minutes (seven days)',
	]);
	t.deepEqual(
		pnpmPolicyProblems(good.replace('blockExoticSubdeps: true\n', '')),
		['blockExoticSubdeps must be true'],
	);
	t.deepEqual(pnpmPolicyProblems(good.replace('no-downgrade', 'off')), [
		'trustPolicy must be no-downgrade',
	]);
	t.deepEqual(pnpmPolicyProblems(`${good}\n  left-pad: true`), [
		'left-pad may not run install scripts: only electron, esbuild, node-pty may',
	]);
});

test('SEC-18 every pnpm install in a workflow uses the frozen lockfile', t => {
	t.deepEqual(
		installProblems(
			[
				'      - run: pnpm install --frozen-lockfile',
				'      - run: pnpm install',
				'      - run: pnpm install --ignore-scripts',
				'      - run: pnpm add left-pad',
				'      - run: pnpm installation-notes',
			].join('\n'),
		),
		['pnpm install', 'pnpm install --ignore-scripts', 'pnpm add left-pad'],
	);
});

test('SEC-18 the repository itself meets all of it', t => {
	const workflows = '.github/workflows';
	for (const name of readdirSync(workflows).filter(file =>
		file.endsWith('.yml'),
	)) {
		const text = readFileSync(path.join(workflows, name), 'utf8');
		t.deepEqual(
			unpinnedReferences(text),
			[],
			`${name} has an unpinned reference`,
		);
		t.deepEqual(
			installProblems(text),
			[],
			`${name} installs without the frozen lockfile`,
		);
	}
	t.true(pinnedElectron(JSON.parse(readFileSync('package.json', 'utf8'))));
	t.deepEqual(
		pnpmPolicyProblems(readFileSync('pnpm-workspace.yaml', 'utf8')),
		[],
	);
});
