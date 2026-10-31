import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';

function unisolatedLaunches(source: string, filename: string): string[] {
	const code = source.replace(
		/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
		value => value.replace(/[^\n]/g, ' '),
	);
	return [...code.matchAll(/\b(?:\w+\.launch|spawn)\s*\(/g)].flatMap(call => {
		const start = call.index + call[0].length;
		let end = start;
		let depth = 1;
		while (end < code.length && depth) {
			if (code[end] === '(') depth++;
			if (code[end] === ')') depth--;
			end++;
		}
		const invocation = source.slice(start, end - 1);
		const args =
			invocation.match(/\bargs\s*:\s*\[([^\]]*)\]/)?.[1] ??
			(call[0].startsWith('spawn') &&
				invocation.match(/^[^,]+,\s*\[([^\]]*)\]/)?.[1]);
		const profile =
			typeof args === 'string' &&
			args.match(
				/`--user-data-dir=\$\{(?:path\.join\(\s*(\w+)\s*,\s*['"]profile['"]\s*\)|(\w+))\}`/,
			);
		const root = profile && (profile[1] ?? profile[2]);
		const temporary =
			root &&
			[
				...code.matchAll(
					/\b(\w+)\s*=\s*(?:realpathSync(?:\.native)?\s*\(\s*)?mkdtempSync\s*\(/g,
				),
			].some(assignment => assignment[1] === root);
		if (temporary && args && args.split('--user-data-dir').length === 2)
			return [];
		const line = source.slice(0, call.index).split('\n').length;
		return [`${filename}:${line}: launch needs a temporary --user-data-dir`];
	});
}

test('every e2e app launch uses a temporary profile, including helper and QA launchers', t => {
	const root = path.resolve(import.meta.dirname, '..');
	const failures = readdirSync(root, {recursive: true, encoding: 'utf8'})
		.filter(name => name.endsWith('.ts'))
		// This spec contains deliberately unsafe, non-executable launch examples.
		.filter(name => path.join(root, name) !== import.meta.filename)
		.flatMap(name =>
			unisolatedLaunches(readFileSync(path.join(root, name), 'utf8'), name),
		);
	t.deepEqual(failures, []);
});

test('the guard checks each launch, not just a profile flag elsewhere in the file', t => {
	const failures = unisolatedLaunches(
		"const work = mkdtempSync('fixture-'); electron.launch({args: ['.', `--user-data-dir=${path.join(work, 'profile')}`]}); electron.launch({args: ['.']});",
		'fixture.ts',
	);
	t.is(failures.length, 1);
});

test('the guard refuses shared profiles and paths escaping a temporary folder', t => {
	for (const profile of [
		'profile',
		"path.join(work, '..', 'profile')",
		"path.join(work, '/shared')",
	]) {
		const source = [
			"const work = mkdtempSync('fixture-'); const profile = '/shared'; electron.launch({args: ['.', `--user-data-dir=${",
			profile,
			'}`]});',
		].join('');
		t.is(unisolatedLaunches(source, 'fixture.ts').length, 1);
	}
});

test('the guard follows temporary profile assignments and secondary app spawns', t => {
	t.deepEqual(
		unisolatedLaunches(
			"let profile; profile = realpathSync.native(mkdtempSync('fixture-')); const launch = () => electron.launch({args: ['.', `--user-data-dir=${profile}`]}); launch(); spawn(executable, ['.', `--user-data-dir=${profile}`]);",
			'fixture.ts',
		),
		[],
	);
	t.is(unisolatedLaunches("spawn(executable, ['.']);", 'fixture.ts').length, 1);
});
