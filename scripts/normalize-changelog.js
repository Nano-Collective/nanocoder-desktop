#!/usr/bin/env node

// After `changeset version`: level-1 version headings and one flat list, as in
// the other Nano Collective projects.
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = join(rootDir, 'CHANGELOG.md');

const raw = readFileSync(changelogPath, 'utf8');
const sections = raw.split(/\n(?=#{1,2} \d)/);

if (sections.length < 2) {
	process.exit(0);
}

const newest = sections[1];

if (!/^## \d/.test(newest)) {
	process.exit(0);
}

let normalized = newest
	.replace(/^## /, '# ')
	.replace(/^### (?:Major|Minor|Patch) Changes[^\n]*\n?/gm, '');

normalized = normalized.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');

sections[1] = `${normalized}\n`;

writeFileSync(changelogPath, sections.join('\n'), 'utf8');
console.log('CHANGELOG.md normalised');
