import {readFileSync} from 'node:fs';
import path from 'node:path';
import {packageNames, youngPackages} from './lib/bundle.mjs';

// The desktop's own dependencies wait 7 days after release (pnpm-workspace.yaml). npm does not apply that to
// the bundled tree, so this reports any locked version younger than that. Run it when the bundle's lock changes.
// First-party packages are exempt, as `electron` is in pnpm-workspace.yaml.
const MIN_DAYS = Number(process.env.BUNDLE_MIN_AGE_DAYS ?? 7);
const EXEMPT = ['@nanocollective/'];
const lock = JSON.parse(
	readFileSync(
		path.resolve(
			import.meta.dirname,
			'..',
			'bundle',
			'nanocoder',
			'package-lock.json',
		),
		'utf8',
	),
);
const names = [...new Set(packageNames(lock).map(([name]) => name))];
const times = {};
let next = 0;
async function worker() {
	while (next < names.length) {
		const name = names[next++];
		const response = await fetch(
			`https://registry.npmjs.org/${name.replaceAll('/', '%2F')}`,
		);
		if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
		times[name] = (await response.json()).time ?? {};
	}
}
await Promise.all(Array.from({length: 8}, worker));
const {young, unknown} = youngPackages(
	lock,
	times,
	new Date(),
	MIN_DAYS,
	EXEMPT,
);
console.log(
	`${names.length} packages checked against a ${MIN_DAYS} day age gate (first-party exempt)`,
);
for (const item of young)
	console.error(`Too new: ${item.name}@${item.version} (${item.days} days)`);
for (const item of unknown) console.error(`No publish time: ${item}`);
if (young.length > 0 || unknown.length > 0) process.exit(1);
console.log('Every locked version is old enough');
