import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ElectronApplication, Page} from '@playwright/test';
import {electron} from '../electron';
import {qaEnvironment} from '../environment';

export const root = path.resolve(import.meta.dirname, '../../..');
const fixtureSource = path.join(
	root,
	'source/main/nanocoder/fixtures/fake-nanocoder.mjs',
);

export const THEMES = ['dark', 'light'] as const;
export const WIDTHS = [1240, 1020, 840] as const;
export const HEIGHT = 800;

export type Theme = (typeof THEMES)[number];

// Capture-only copy of the fake Nanocoder with text swapped for mockup-like content.
// Each `from` must occur exactly once in the fixture, or the launch fails.
export interface FixtureEdit {
	from: string;
	to: string;
}

export interface Capture {
	app: ElectronApplication;
	page: Page;
	// Temporary root: fixture copy, projects and the user-data profile. Removed by the runner.
	work: string;
	// Creates <work>/projects/<name> with the fake mode file and returns its path.
	project(name: string, mode?: string): string;
	// Stubs the folder picker to return `folder` (null cancels), then clicks the open action.
	openProject(folder: string | null): Promise<void>;
	// Sets the button index the next native message box returns (0 = first button).
	nativeAnswer(response: number): Promise<void>;
	// Closes the app and starts it again on the same profile. Updates `app` and `page`.
	restart(): Promise<void>;
}

export interface CaptureState {
	// Reference file stem without theme and width, e.g. "conversation-ready" or "rename".
	stem: string;
	// Manifest id, e.g. "conversation-ready".
	manifestId: string;
	// Fake fixture mode and edits, for index.md.
	fixture: string;
	// How the state is reached, for index.md.
	how: string;
	// Drives the app into the state. Runs once per fresh launch, in the dark theme at the first width.
	reach?: (capture: Capture) => Promise<void>;
	// Re-arms transient UI (for example a toast) before each shot.
	beforeShot?: (capture: Capture, theme: Theme, width: number) => Promise<void>;
	// Set when the app cannot reach this state. The reason goes to index.md.
	notReachable?: string;
	fixtureEdits?: readonly FixtureEdit[];
}

function applyEdits(source: string, edits: readonly FixtureEdit[]): string {
	let text = source;
	for (const {from, to} of edits) {
		const count = text.split(from).length - 1;
		if (count !== 1)
			throw new Error(
				`fixture edit matched ${count} times: ${from.slice(0, 60)}`,
			);
		text = text.replace(from, () => to);
	}
	return text;
}

export function pngSize(bytes: Buffer): {width: number; height: number} {
	if (bytes.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n')
		throw new Error('not a PNG');
	return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

interface LaunchOptions {
	edits?: readonly FixtureEdit[];
}

async function startApp(
	work: string,
	edits: readonly FixtureEdit[],
): Promise<{app: ElectronApplication; page: Page}> {
	const cli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(cli, applyEdits(readFileSync(fixtureSource, 'utf8'), edits));
	writeFileSync(
		path.join(work, 'nanocoder/package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	const app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	// Native dialogs cannot be captured from the page. The stub answers them (0 = first button)
	// so no modal blocks the hidden app. The folder picker is cancelled until openProject sets it.
	await app.evaluate(({dialog}) => {
		const native = {response: 0};
		const picker: {filePaths: string[]; canceled: boolean} = {
			filePaths: [],
			canceled: true,
		};
		Object.assign(globalThis, {
			ncCaptureNative: native,
			ncCapturePicker: picker,
		});
		dialog.showOpenDialog = (async () => ({
			canceled: picker.canceled,
			filePaths: picker.filePaths,
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (async () => ({
			response: native.response,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
	});
	const page = await app.firstWindow();
	await page.emulateMedia({reducedMotion: 'reduce'});
	await setWidth(page, WIDTHS[0]);
	return {app, page};
}

export async function launchCapture(
	options: LaunchOptions = {},
): Promise<Capture> {
	const edits = options.edits ?? [];
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-ui-capture-')),
	);
	mkdirSync(path.join(work, 'projects'), {recursive: true});
	const started = await startApp(work, edits);
	const capture: Capture = {
		...started,
		work,
		project(name, mode) {
			const dir = path.join(work, 'projects', name);
			mkdirSync(dir, {recursive: true});
			if (mode) writeFileSync(path.join(dir, '.fake-nanocoder'), mode);
			return dir;
		},
		async openProject(folder) {
			await capture.app.evaluate(({}, picked) => {
				const picker = (
					globalThis as unknown as {
						ncCapturePicker: {filePaths: string[]; canceled: boolean};
					}
				).ncCapturePicker;
				picker.canceled = picked === null;
				picker.filePaths = picked === null ? [] : [picked];
			}, folder);
			await capture.page
				.getByRole('button', {name: 'open a project folder'})
				.click();
		},
		async nativeAnswer(response) {
			await capture.app.evaluate(({}, value) => {
				(
					globalThis as unknown as {ncCaptureNative: {response: number}}
				).ncCaptureNative.response = value;
			}, response);
		},
		async restart() {
			await capture.app.close();
			const next = await startApp(work, edits);
			capture.app = next.app;
			capture.page = next.page;
		},
	};
	return capture;
}

export async function setTheme(page: Page, theme: Theme): Promise<void> {
	await page.evaluate(value => {
		document.documentElement.dataset.theme = value;
	}, theme);
}

export async function setWidth(page: Page, width: number): Promise<void> {
	await page.setViewportSize({width, height: HEIGHT});
}

export async function shot(page: Page, file: string): Promise<void> {
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({path: file, scale: 'css', animations: 'disabled'});
}

export type SelectorMap = Readonly<Record<string, string>>;

interface Sides<T> {
	top: T;
	right: T;
	bottom: T;
	left: T;
}

interface ElementGeometry {
	tag: string;
	rect: {x: number; y: number; width: number; height: number};
	style: {
		display: string;
		fontSize: string;
		lineHeight: string;
		padding: Sides<string>;
		gap: {row: string; column: string};
		radius: {
			topLeft: string;
			topRight: string;
			bottomRight: string;
			bottomLeft: string;
		};
		border: Sides<{width: string; style: string; color: string}>;
		background: string;
		color: string;
	};
}

type SelectorGeometry =
	| {selector: string; count: number; elements: ElementGeometry[]}
	| {selector: string; error: string};

// Keeps the first matches only, so a broad selector cannot make a huge file. count is the full total.
const MAX_ELEMENTS = 20;

// Measures each selector as the page is at this shot. Rects are viewport CSS px, the same space as the PNG.
export function measure(
	page: Page,
	selectors: SelectorMap,
): Promise<Record<string, SelectorGeometry>> {
	return page.evaluate(
		({entries, limit}: {entries: [string, string][]; limit: number}) => {
			const out: Record<string, SelectorGeometry> = {};
			for (const [key, selector] of entries) {
				let nodes: Element[];
				try {
					nodes = Array.from(document.querySelectorAll(selector));
				} catch (error) {
					out[key] = {selector, error: String(error)};
					continue;
				}
				out[key] = {
					selector,
					count: nodes.length,
					elements: nodes.slice(0, limit).map(element => {
						const box = element.getBoundingClientRect();
						const computed = getComputedStyle(element);
						return {
							tag: element.tagName.toLowerCase(),
							rect: {
								x: Math.round(box.x * 100) / 100,
								y: Math.round(box.y * 100) / 100,
								width: Math.round(box.width * 100) / 100,
								height: Math.round(box.height * 100) / 100,
							},
							style: {
								display: computed.display,
								fontSize: computed.fontSize,
								lineHeight: computed.lineHeight,
								padding: {
									top: computed.paddingTop,
									right: computed.paddingRight,
									bottom: computed.paddingBottom,
									left: computed.paddingLeft,
								},
								gap: {row: computed.rowGap, column: computed.columnGap},
								radius: {
									topLeft: computed.borderTopLeftRadius,
									topRight: computed.borderTopRightRadius,
									bottomRight: computed.borderBottomRightRadius,
									bottomLeft: computed.borderBottomLeftRadius,
								},
								border: {
									top: {
										width: computed.borderTopWidth,
										style: computed.borderTopStyle,
										color: computed.borderTopColor,
									},
									right: {
										width: computed.borderRightWidth,
										style: computed.borderRightStyle,
										color: computed.borderRightColor,
									},
									bottom: {
										width: computed.borderBottomWidth,
										style: computed.borderBottomStyle,
										color: computed.borderBottomColor,
									},
									left: {
										width: computed.borderLeftWidth,
										style: computed.borderLeftStyle,
										color: computed.borderLeftColor,
									},
								},
								background: computed.backgroundColor,
								color: computed.color,
							},
						};
					}),
				};
			}
			return out;
		},
		{entries: Object.entries(selectors), limit: MAX_ELEMENTS},
	);
}
