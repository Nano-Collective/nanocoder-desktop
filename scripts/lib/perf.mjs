import {median, summarise} from './runtime.mjs';

export {median, summarise};

// The budgets in planning/testing-strategy.md, in milliseconds (PERF-05 to PERF-08).
export const BUDGETS = {
	'PERF-05': 300,
	'PERF-06': 500,
	'PERF-07': 5000,
	'PERF-08': 1000,
};

export function verdict(id, milliseconds) {
	const budget = BUDGETS[id];
	if (budget === undefined) throw new Error(`No budget for ${id}`);
	return {ok: milliseconds <= budget, budget};
}

// How many entries each directory holds directly, from the tracked file paths, and the fullest one.
export function largestDirectory(paths) {
	const children = new Map();
	const add = (directory, name) => {
		if (!children.has(directory)) children.set(directory, new Set());
		children.get(directory).add(name);
	};
	for (const file of paths) {
		const parts = file.split('/');
		for (let depth = 0; depth < parts.length; depth++)
			add(parts.slice(0, depth).join('/'), parts[depth]);
	}
	let best = {directory: '', entries: 0};
	for (const [directory, names] of children)
		if (names.size > best.entries) best = {directory, entries: names.size};
	return best;
}

export function largestFileUnder(files, limit) {
	let best;
	for (const file of files)
		if (file.size > 0 && file.size <= limit && (!best || file.size > best.size))
			best = file;
	return best;
}

export function parseArgs(argv) {
	const options = {
		repo: undefined,
		runs: 5,
		json: undefined,
		resume: false,
		noFail: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = () => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${flag} needs a value`);
			return next;
		};
		if (flag === '--repo') options.repo = value();
		else if (flag === '--json') options.json = value();
		else if (flag === '--runs') {
			const runs = Number(value());
			if (!Number.isInteger(runs) || runs < 1)
				throw new Error('--runs must be a whole number of at least 1');
			options.runs = runs;
		} else if (flag === '--resume') options.resume = true;
		else if (flag === '--no-fail') options.noFail = true;
		else throw new Error(`Unknown argument ${flag}`);
	}
	return options;
}

const range = ms =>
	`${Math.round(ms.median)} ms (${Math.round(ms.min)} to ${Math.round(ms.max)})`;
const count = value => value.toLocaleString('en-US');

export function formatReport(report) {
	const {machine, repository} = report;
	const rows = report.measurements.map(item => {
		const budget = BUDGETS[item.id];
		const limit = budget === undefined ? 'recorded' : `${budget} ms`;
		if (item.skipped)
			return `| ${item.id} | ${item.what} | not measured | ${limit} | ${item.skipped} |`;
		const outcome =
			budget === undefined
				? (item.detail ?? 'recorded')
				: `${verdict(item.id, item.ms.median).ok ? 'within budget' : 'OVER BUDGET'}${item.detail ? `: ${item.detail}` : ''}`;
		return `| ${item.id} | ${item.what} | ${range(item.ms)} | ${limit} | ${outcome} |`;
	});
	return [
		`### Large project measurement, ${machine.platform}`,
		'',
		`Machine: ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGb} GB, Node ${machine.node}, Git ${machine.git}.`,
		`Repository: ${repository.kind}, ${count(repository.files)} tracked files, fullest directory \`${repository.directory || '.'}\` with ${count(repository.directoryEntries)} entries. Median of ${report.runs} runs.`,
		'',
		'| ID | Measurement | Median (range) | Budget | Result |',
		'|---|---|---|---|---|',
		...rows,
		'',
	].join('\n');
}
