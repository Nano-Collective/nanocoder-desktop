#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {
	appendFileSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
	checksumFile,
	extractChangelog,
	releaseDecision,
	releaseNotes,
} from './lib/release.mjs';

function option(name) {
	const index = process.argv.indexOf(`--${name}`);
	const value = index === -1 ? undefined : process.argv[index + 1];
	if (!value) throw new Error(`--${name} is required`);
	return value;
}

const version = () => JSON.parse(readFileSync('package.json', 'utf8')).version;

const [command] = process.argv.slice(2);

if (command === 'check') {
	const decision = releaseDecision({
		version: version(),
		exists: process.env.RELEASE_EXISTS === 'true',
	});
	console.log(decision.reason);
	const lines = [
		`should-release=${decision.release}`,
		`prerelease=${decision.prerelease}`,
		`tag=${decision.tag}`,
		`version=${version()}`,
	].join('\n');
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
	else console.log(lines);
} else if (command === 'notes') {
	const current = version();
	const body = releaseNotes({
		version: current,
		prerelease: current.includes('-'),
		changelog: extractChangelog(readFileSync('CHANGELOG.md', 'utf8'), current),
	});
	writeFileSync(option('out'), body);
} else if (command === 'checksums') {
	const dir = option('dir');
	const entries = readdirSync(dir, {withFileTypes: true})
		.filter(entry => entry.isFile())
		.map(entry => ({
			name: entry.name,
			sha256: createHash('sha256')
				.update(readFileSync(path.join(dir, entry.name)))
				.digest('hex'),
		}));
	if (entries.length === 0) throw new Error(`no installers found in ${dir}`);
	writeFileSync(option('out'), checksumFile(entries));
} else {
	throw new Error(
		'usage: release.mjs check | notes --out F | checksums --dir D --out F',
	);
}
