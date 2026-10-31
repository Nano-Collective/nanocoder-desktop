import {
	copyFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import type {Page} from '@playwright/test';
import {
	type CaptureState,
	HEIGHT,
	launchCapture,
	measure,
	pngSize,
	root,
	type SelectorMap,
	setTheme,
	setWidth,
	shot,
	THEMES,
	type Theme,
	WIDTHS,
} from './harness';
import {states} from './states';

type Status = 'captured' | 'not-reachable' | 'failed';

interface Result {
	state: CaptureState;
	status: Status;
	files: string[];
	error?: string;
	seconds: number;
}

function option(argv: readonly string[], name: string): string | undefined {
	const prefix = `--${name}=`;
	return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

// Three hidden instances at most, the limit in the shared E2E lock agreement.
const MAX_CONCURRENCY = 3;

// Flat, like the reference: every screenshot goes to screens/.
const SCREENS = 'screens';

async function runState(
	state: CaptureState,
	out: string,
	selectors?: SelectorMap,
): Promise<Result> {
	const started = performance.now();
	const seconds = () => (performance.now() - started) / 1000;
	if (state.notReachable)
		return {state, status: 'not-reachable', files: [], seconds: seconds()};
	const dir = path.join(out, SCREENS);
	mkdirSync(dir, {recursive: true});
	const files: string[] = [];
	const capture = await launchCapture({edits: state.fixtureEdits});
	try {
		await state.reach?.(capture);
		for (const theme of THEMES) {
			for (const width of WIDTHS) {
				await setTheme(capture.page, theme);
				await setWidth(capture.page, width);
				await state.beforeShot?.(capture, theme, width);
				const file = path.join(dir, `${state.stem}-${theme}-${width}.png`);
				await shot(capture.page, file);
				const size = pngSize(readFileSync(file));
				if (size.width !== width || size.height !== HEIGHT)
					throw new Error(
						`${path.basename(file)} is ${size.width}x${size.height}`,
					);
				files.push(file);
				if (selectors)
					files.push(
						await writeGeometry(
							capture.page,
							selectors,
							state,
							theme,
							width,
							out,
						),
					);
			}
		}
		return {state, status: 'captured', files, seconds: seconds()};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {state, status: 'failed', files, error: message, seconds: seconds()};
	} finally {
		await capture.app.close();
		rmSync(capture.work, {recursive: true, force: true});
	}
}

// Reads the selector map from --geometry: a JSON object of key to CSS selector.
function readSelectors(file: string): SelectorMap {
	const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error(`${file} must hold a JSON object of key to CSS selector`);
	for (const [key, selector] of Object.entries(value))
		if (typeof selector !== 'string' || selector.trim() === '')
			throw new Error(`${key} must map to a non-empty CSS selector`);
	return value as SelectorMap;
}

async function writeGeometry(
	page: Page,
	selectors: SelectorMap,
	state: CaptureState,
	theme: Theme,
	width: number,
	out: string,
): Promise<string> {
	const measured = await measure(page, selectors);
	const invalid = Object.entries(measured).flatMap(([key, value]) =>
		'error' in value ? [`${key} (${value.selector})`] : [],
	);
	if (invalid.length)
		throw new Error(`invalid CSS selectors: ${invalid.join(', ')}`);
	const dir = path.join(out, 'geometry');
	mkdirSync(dir, {recursive: true});
	const file = path.join(dir, `${state.stem}-${theme}-${width}.json`);
	const body = {
		state: state.manifestId,
		theme,
		width,
		height: HEIGHT,
		coordinates:
			'viewport CSS px, origin top left, same space as the PNG at scale 1; rounded to 0.01',
		selectors: measured,
	};
	writeFileSync(file, `${JSON.stringify(body, null, '\t')}\n`);
	return file;
}

async function pool<T, R>(
	items: readonly T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const lanes = Array.from(
		{length: Math.min(limit, items.length)},
		async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await run(items[index]);
			}
		},
	);
	await Promise.all(lanes);
	return results;
}

function writeIndex(
	results: readonly Result[],
	out: string,
	totalSeconds: number,
	keys: readonly string[] | undefined,
) {
	const rows = results.map(({state, status, files, error}) => {
		const reached = state.notReachable
			? `not reachable: ${state.notReachable}`
			: state.how;
		const outcome = error ? `failed: ${error}` : status;
		const png = files.filter(file => file.endsWith('.png')).length;
		const json = files.length - png;
		const count = `${png}${json ? ` + ${json} json` : ''}`;
		return `| ${SCREENS}/${state.stem} | ${state.manifestId} | ${state.fixture} | ${reached} | ${outcome} | ${count} |`;
	});
	const notReachable = results
		.filter(r => r.status === 'not-reachable')
		.map(r => `- ${r.state.manifestId}: ${r.state.notReachable}`);
	const failed = results.filter(r => r.status === 'failed');
	const captured = results.filter(r => r.status === 'captured');
	const pngs = results.reduce(
		(sum, r) => sum + r.files.filter(file => file.endsWith('.png')).length,
		0,
	);
	const text = [
		'# App capture, milestone-1 at 08eb449',
		'',
		`Viewport ${WIDTHS.join(', ')} px wide, ${HEIGHT} px high, CSS pixel scale, reduced motion. Themes: ${THEMES.join(', ')} (set on the root element as data-theme). Fake Nanocoder fixtures only.`,
		`Full run: ${totalSeconds.toFixed(0)} s. ${results.length} states: ${captured.length} captured (${pngs} PNG), ${notReachable.length} not reachable, ${failed.length} failed.`,
		...(keys
			? [
					`Geometry: ${keys.length} selector keys (${keys.join(', ')}), one JSON per state, theme and width, in geometry/. Source map: geometry/selectors.json. Rects are viewport CSS px, the same space as the PNG.`,
				]
			: []),
		'',
		'| File stem | Manifest id | Fixture | How reached | Status | Files |',
		'| --- | --- | --- | --- | --- | --- |',
		...rows,
		'',
		'## Not reachable in app',
		'',
		...(notReachable.length ? notReachable : ['None.']),
		'',
		'## Failed',
		'',
		...(failed.length
			? failed.map(r => `- ${r.state.manifestId}: ${r.error}`)
			: ['None.']),
		'',
		'## Notes',
		'',
		'- No toast follows an import in the app. The toast state is the nearest real toast, the theme switch, with the copy "switched to <theme> theme" instead of the reference "thread metadata imported. selection and draft unchanged."',
		'- Archive and remove-thread act at once, with no confirmation step, so their reference dialogs are not reachable.',
		'- Repeat runs can differ in small regions: recents show temp project paths with a random 6-character folder suffix, the header control at top right can change, and one mode-control geometry entry can measure zero in one run.',
		'',
	].join('\n');
	writeFileSync(path.join(out, 'index.md'), text);
}

const argv = process.argv.slice(2);
const only = option(argv, 'only')?.split(',');
const out = path.resolve(
	option(argv, 'out') ?? path.join(root, '.qa/ui-fidelity/app-08eb449'),
);
const geometry = option(argv, 'geometry');
const selectors = geometry ? readSelectors(path.resolve(geometry)) : undefined;
if (geometry) {
	mkdirSync(path.join(out, 'geometry'), {recursive: true});
	copyFileSync(
		path.resolve(geometry),
		path.join(out, 'geometry', 'selectors.json'),
	);
}
const concurrency = Math.min(
	MAX_CONCURRENCY,
	Number(option(argv, 'concurrency') ?? MAX_CONCURRENCY),
);
const selected = states.filter(
	state =>
		!only || only.includes(state.stem) || only.includes(state.manifestId),
);
const started = performance.now();
const results = await pool(selected, concurrency, async state => {
	const result = await runState(state, out, selectors);
	console.info(
		`${result.status.padEnd(13)} ${SCREENS}/${state.stem} (${result.files.length} files, ${result.seconds.toFixed(1)} s)${result.error ? ` ${result.error}` : ''}`,
	);
	return result;
});
const total = (performance.now() - started) / 1000;
writeIndex(results, out, total, selectors && Object.keys(selectors));
console.info(`done in ${total.toFixed(0)} s, output ${out}`);
const failures = results.filter(result => result.status === 'failed').length;
process.exitCode = failures > 0 ? 1 : 0;
