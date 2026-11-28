import {execFileSync} from 'node:child_process';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	type ElectronApplication,
	expect,
	type Page,
	test,
} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import {turnEnded} from './qa/turn-state';
import {visibleTextContrast} from './qa/ui-contrast';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, '.qa/pr-evidence');
const findKey = process.platform === 'darwin' ? 'Meta+f' : 'Control+f';
const paletteKey = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
const shortcutKeys = process.platform === 'darwin' ? '⌘F' : 'Ctrl+F';
const transcriptScope = 'loaded transcript';
const diffScope = 'first 5,000 diff rows';

interface Session {
	app: ElectronApplication;
	page: Page;
	work: string;
}

interface FindProbe {
	updates: number;
	firstUpdate: number;
	lastUpdate: number;
	frameGaps: number[];
	inputFrameMs: number[];
	eventLoopMs: number[];
	stop: boolean;
}

interface ProbeWindow extends Window {
	findProbe: FindProbe;
	desktop: DesktopApi;
}

// Nearest-rank percentile, as in streaming.e2e.ts.
function percentile(values: number[], quantile: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.ceil(quantile * sorted.length) - 1];
}

function round(value: number): number {
	return Number(value.toFixed(1));
}

// A fresh profile and project. The fake Nanocoder behaves as `mode` says.
async function openSession(
	mode: string,
	setup?: (project: string) => void,
): Promise<Session> {
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-find-')),
	);
	const project = path.join(work, 'project');
	const cli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	mkdirSync(project);
	writeFileSync(
		path.join(work, 'nanocoder/package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync(
		path.join(root, 'source/main/nanocoder/fixtures/fake-nanocoder.mjs'),
		cli,
	);
	writeFileSync(path.join(project, '.fake-nanocoder'), mode);
	setup?.(project);
	const app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {
			cliPath: cli,
			nodePath: process.execPath,
		}),
	});
	const page = await app.firstWindow();
	await page.setViewportSize({width: 1240, height: 900});
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (async () => ({
			response: 0,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
	}, project);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(composer(page)).toBeEnabled();
	return {app, page, work};
}

async function closeSession(session: Session): Promise<void> {
	try {
		await session.app.close();
	} finally {
		rmSync(session.work, {recursive: true, force: true});
	}
}

// A changed large.ts: 2,505 replaced lines make 5,015 parsed rows, past the 5,000-row cap.
function writeLargeRepo(project: string): void {
	const oldText = Array.from(
		{length: 2_505},
		(_, index) => `old line ${index + 1}`,
	).join('\n');
	const newText = Array.from({length: 2_505}, (_, index) =>
		index === 2_449
			? `new line ${index + 1} ${'padding '.repeat(30)}far-right-token`
			: `new line ${index + 1}`,
	).join('\n');
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'core.hooksPath=', ...args], {
			cwd: project,
			encoding: 'utf8',
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		});
	writeFileSync(path.join(project, 'README.md'), '# fake fixture\n');
	writeFileSync(path.join(project, 'large.ts'), `${oldText}\n`);
	git('-c', 'init.defaultBranch=main', 'init', '-q');
	git('config', 'core.autocrlf', 'false');
	mkdirSync(path.join(project, '.git/info'), {recursive: true});
	writeFileSync(path.join(project, '.git/info/exclude'), '.fake-nanocoder\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'initial fake fixture');
	writeFileSync(path.join(project, 'large.ts'), `${newText}\n`);
	writeFileSync(path.join(project, 'README.md'), '# fake fixture\nedited\n');
}

function profileFilesContaining(dir: string, needle: string): string[] {
	const hits: string[] = [];
	const walk = (folder: string): void => {
		for (const entry of readdirSync(folder, {withFileTypes: true})) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (entry.isFile() && readFileSync(file).includes(needle))
				hits.push(path.relative(dir, file));
		}
	};
	walk(dir);
	return hits;
}

async function ask(page: Page, text: string): Promise<void> {
	await composer(page).fill(text);
	await page.getByRole('button', {name: 'send', exact: true}).click();
}

function composer(page: Page) {
	return page.getByRole('textbox', {name: 'message', exact: true});
}

function transcriptBar(page: Page) {
	return page.locator('.shell-find-bar .find-bar');
}

function transcriptInput(page: Page) {
	return page.getByRole('searchbox', {
		name: 'find in conversation',
		exact: true,
	});
}

function transcriptStatus(page: Page) {
	return transcriptBar(page).locator('.find-bar-status');
}

function diffBar(page: Page) {
	return page.locator('.diff-view .find-bar');
}

function diffStatus(page: Page) {
	return page.locator('.diff-view .find-bar-status');
}

// Evidence screenshots use the fake fixture only, never a real conversation.
async function capture(page: Page, name: string): Promise<void> {
	mkdirSync(evidence, {recursive: true});
	await page.screenshot({path: path.join(evidence, name)});
}

function highlightState(page: Page) {
	return page.evaluate(() => ({
		match: CSS.highlights.get('find-match')?.size ?? 0,
		active: CSS.highlights.get('find-active')?.size ?? 0,
	}));
}

function highlightNames(page: Page) {
	return page.evaluate(() => ({
		match: CSS.highlights.has('find-match'),
		active: CSS.highlights.has('find-active'),
	}));
}

function conversationOrder(page: Page) {
	return page.locator('ol[aria-label="conversation"] > li').evaluateAll(items =>
		items.flatMap(item => {
			const kind = /gate-message-(user|agent|failure)\b/.exec(
				item.className,
			)?.[1];
			return kind ? [kind] : [];
		}),
	);
}

function probeUpdates(page: Page) {
	return page.evaluate(
		() => (window as unknown as ProbeWindow).findProbe.updates,
	);
}

// Moves the scroller and resolves on the next painted frame, as in streaming.e2e.ts.
function scrollFrame(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const scroller = document.querySelector<HTMLElement>(
					'.shell-stream-scroll',
				);
				if (!scroller || scroller.scrollHeight <= scroller.clientHeight) {
					reject(new Error('fixture must have scrollable content'));
					return;
				}
				const started = performance.now();
				scroller.addEventListener(
					'scroll',
					() =>
						requestAnimationFrame(() => resolve(performance.now() - started)),
					{once: true},
				);
				scroller.scrollTop = scroller.scrollTop > 0 ? 0 : scroller.scrollHeight;
			}),
	);
}

test('#72 transcript find searches user, Markdown, tool and folded detail text', async () => {
	test.setTimeout(120_000);
	const session = await openSession('find-transcript');
	const {page} = session;
	try {
		await ask(page, 'zephyr question from the user');
		await expect(turnEnded(page)).toBeVisible();
		const detail = page.locator('[data-find-id$=":tool-content:0"]');
		await expect(page.locator('.stream-markdown h1')).toHaveText(
			'zephyr heading',
		);
		await expect(detail).toBeHidden();

		await composer(page).focus();
		await page.keyboard.press(findKey);
		await expect(transcriptInput(page)).toBeFocused();
		await expect(transcriptStatus(page)).toHaveText(transcriptScope);
		await transcriptInput(page).fill('zephyr');
		await expect(transcriptStatus(page)).toHaveText(
			`1 of 7 · ${transcriptScope}`,
		);
		await expect.poll(() => highlightState(page)).toMatchObject({active: 1});
		expect((await highlightState(page)).match).toBeGreaterThanOrEqual(1);
		await expect(page.locator('.stream-markdown mark')).toHaveCount(0);

		for (let step = 2; step <= 7; step++) {
			await page.keyboard.press('Enter');
			await expect(transcriptStatus(page)).toHaveText(
				`${step} of 7 · ${transcriptScope}`,
			);
		}
		// The seventh match is in the folded tool output, which opens and comes into view.
		await expect(detail).toBeInViewport();
		await expect
			.poll(() => detail.evaluate(el => el.closest('details')?.open === true))
			.toBe(true);
		await page.keyboard.press('Enter');
		await expect(transcriptStatus(page)).toHaveText(
			`1 of 7 · ${transcriptScope}`,
		);
		await page.keyboard.press('Shift+Enter');
		await expect(transcriptStatus(page)).toHaveText(
			`7 of 7 · ${transcriptScope}`,
		);

		await page.keyboard.press('Escape');
		await expect(transcriptBar(page)).toHaveCount(0);
		await expect(composer(page)).toBeFocused();
		await expect
			.poll(() => highlightNames(page))
			.toEqual({match: false, active: false});

		await page.keyboard.press(findKey);
		await expect(transcriptInput(page)).toBeFocused();
		await transcriptInput(page).fill('zzz-no-such-text');
		await expect(transcriptStatus(page)).toHaveText(
			`no matches in ${transcriptScope}`,
		);
		await expect(
			page.getByRole('button', {name: 'previous match'}),
		).toBeDisabled();
		await expect(page.getByRole('button', {name: 'next match'})).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(composer(page)).toBeFocused();

		await page.keyboard.press(findKey);
		await transcriptInput(page).fill('zephyr');
		await expect(transcriptStatus(page)).toHaveText(
			`1 of 7 · ${transcriptScope}`,
		);
		expect(await visibleTextContrast(page, 'dark')).toEqual([]);
		await capture(page, 'after-transcript-find-dark.png');
		await page.getByRole('button', {name: 'command palette'}).click();
		const palette = page.getByRole('dialog', {
			name: 'command palette',
			exact: true,
		});
		await palette.getByRole('combobox').fill('switch to light');
		await page.keyboard.press('Enter');
		await expect(palette).toBeHidden();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await expect(transcriptStatus(page)).toHaveText(
			`1 of 7 · ${transcriptScope}`,
		);
		// The toast fades in over 180ms, so wait for its settled colours.
		await expect(page.locator('.overlay-toast')).toHaveCSS('opacity', '1');
		expect(await visibleTextContrast(page, 'light')).toEqual([]);
		await capture(page, 'after-transcript-find-light.png');

		await page.setViewportSize({width: 840, height: 800});
		const barBox = await transcriptBar(page).boundingBox();
		const closeBox = await page
			.getByRole('button', {name: 'close find'})
			.boundingBox();
		if (!barBox || !closeBox) throw new Error('find bar is not laid out');
		expect(barBox.x).toBeGreaterThanOrEqual(0);
		expect(barBox.x + barBox.width).toBeLessThanOrEqual(840);
		expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(840);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await page.getByRole('button', {name: 'close find'}).click();
		await expect(transcriptBar(page)).toHaveCount(0);

		await page.keyboard.press(paletteKey);
		await palette.getByRole('combobox').fill('find in conversation');
		await expect(
			palette.getByRole('option', {name: /find in conversation/}),
		).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(transcriptInput(page)).toBeFocused();
		await page.getByRole('button', {name: 'close find'}).click();

		await page.getByRole('button', {name: 'command palette'}).focus();
		await page.keyboard.press('?');
		const sheet = page.getByRole('dialog', {
			name: 'keyboard shortcuts',
			exact: true,
		});
		await expect(sheet).toBeVisible();
		// A modal dialog owns keyboard focus; Cmd/Ctrl+F must not open find behind it.
		await page.keyboard.press(findKey);
		await expect(transcriptBar(page)).toHaveCount(0);
		await expect(sheet.locator('.shortcut-list')).toContainText(
			'find in conversation or open diff',
		);
		await expect(sheet.locator('.shortcut-list')).toContainText(shortcutKeys);
		await capture(page, 'after-shortcuts.png');
		await sheet.getByRole('button', {name: 'close keyboard shortcuts'}).click();
		await expect(sheet).toBeHidden();

		// Phrases crossing Markdown formatting still match and paint one active range.
		await composer(page).focus();
		await page.keyboard.press(findKey);
		await transcriptInput(page).fill('A zephyr bold');
		await expect(transcriptStatus(page)).toHaveText(
			`1 of 1 · ${transcriptScope}`,
		);
		await expect.poll(() => highlightState(page)).toMatchObject({active: 1});
		await page.keyboard.press('Escape');
		await expect(transcriptBar(page)).toHaveCount(0);
	} finally {
		await closeSession(session);
	}
});

test('#72 the find query is never written to the profile on disk', async () => {
	test.setTimeout(90_000);
	const probe = 'persistence-probe-q7x3';
	const session = await openSession('find-transcript');
	let closed = false;
	try {
		await ask(session.page, 'zephyr question from the user');
		await expect(turnEnded(session.page)).toBeVisible();
		await composer(session.page).focus();
		await session.page.keyboard.press(findKey);
		await transcriptInput(session.page).fill(probe);
		await expect(transcriptStatus(session.page)).toHaveText(
			`no matches in ${transcriptScope}`,
		);
		await session.page.keyboard.press('Escape');
		await expect(composer(session.page)).toBeFocused();
		await session.app.close();
		closed = true;
		const profile = path.join(session.work, 'profile');
		expect(statSync(path.join(profile, 'desktop.sqlite')).size).toBeGreaterThan(
			0,
		);
		expect(profileFilesContaining(profile, probe)).toEqual([]);
	} finally {
		if (!closed) await session.app.close().catch(() => undefined);
		rmSync(session.work, {recursive: true, force: true});
	}
});

test('#72 diff find covers the 5,000-row cap, routes by focus and leaves terminal and browser keys alone', async () => {
	test.setTimeout(180_000);
	const session = await openSession('files', writeLargeRepo);
	const {page} = session;
	try {
		await ask(page, 'diff fixture check');
		await expect(turnEnded(page)).toBeVisible();
		await page.getByRole('button', {name: 'open project files'}).click();
		await page.getByRole('tab', {name: 'review'}).click();
		await page
			.getByRole('list', {name: 'changed files'})
			.getByRole('button', {name: /large\.ts/})
			.click();
		const lines = page.getByRole('listbox', {
			name: /unstaged changes in large\.ts/,
		});
		await expect(lines.getByRole('option').first()).toBeVisible();

		await lines.getByRole('option', {name: /removed line 1:/}).focus();
		await page.keyboard.press(findKey);
		const diffInput = diffBar(page).locator('input');
		await expect(diffInput).toBeFocused();
		await expect(diffStatus(page)).toHaveText(diffScope);
		await expect(transcriptBar(page)).toHaveCount(0);

		await diffInput.fill('new line 2450');
		await expect(diffStatus(page)).toHaveText(`1 of 1 · ${diffScope}`);
		const active = lines.locator('[data-find-active="true"]');
		await expect(active).toHaveCount(1);
		await expect(active).toBeInViewport();
		await expect(active.locator('mark.find-hit--active')).toHaveText(
			'new line 2450',
		);
		await capture(page, 'after-diff-find-dark.png');

		// A match at the far right of an unwrapped line scrolls horizontally into view.
		await diffInput.fill('far-right-token');
		await expect(diffStatus(page)).toHaveText(`1 of 1 · ${diffScope}`);
		const farMark = active.locator('mark.find-hit--active');
		await expect(farMark).toHaveText('far-right-token');
		await expect
			.poll(async () => {
				const [scrollerBox, markBox] = await Promise.all([
					lines.boundingBox(),
					farMark.boundingBox(),
				]);
				if (!scrollerBox || !markBox) return false;
				return (
					markBox.x >= scrollerBox.x &&
					markBox.x + markBox.width <= scrollerBox.x + scrollerBox.width
				);
			})
			.toBe(true);

		const queryStarted = performance.now();
		await diffInput.fill('line');
		await expect(diffStatus(page)).toHaveText(
			/^1 of \d+ · first 5,000 diff rows$/,
		);
		const queryMs = performance.now() - queryStarted;
		const total = Number(
			/ of (\d+) ·/.exec((await diffStatus(page).textContent()) ?? '')?.[1],
		);
		expect(total).toBeGreaterThan(4_000);
		const stepStarted = performance.now();
		for (let step = 0; step < 20; step++) await page.keyboard.press('Enter');
		await expect(diffStatus(page)).toHaveText(`21 of ${total} · ${diffScope}`);
		for (let step = 0; step < 20; step++)
			await page.keyboard.press('Shift+Enter');
		await expect(diffStatus(page)).toHaveText(`1 of ${total} · ${diffScope}`);
		const stepMs = (performance.now() - stepStarted) / 40;
		const mountedRows = await lines.getByRole('option').count();
		expect(mountedRows).toBeLessThan(150);

		await page.keyboard.press('Escape');
		await expect(diffBar(page)).toHaveCount(0);
		await expect
			.poll(() =>
				page.evaluate(() =>
					Boolean(document.activeElement?.closest('.diff-view')),
				),
			)
			.toBe(true);

		// Cmd/Ctrl+F from the review comment textarea opens diff find and returns focus on Escape.
		await lines
			.locator('[role="option"]:not([aria-disabled="true"])')
			.first()
			.click();
		const commentBox = page.locator('.review-comment textarea');
		await expect(commentBox).toBeVisible();
		await commentBox.focus();
		await page.keyboard.press(findKey);
		await expect(diffInput).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(diffBar(page)).toHaveCount(0);
		await expect(commentBox).toBeFocused();

		await composer(page).focus();
		await page.keyboard.press(findKey);
		await expect(transcriptInput(page)).toBeFocused();
		await expect(diffBar(page)).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(transcriptBar(page)).toHaveCount(0);
		await expect(composer(page)).toBeFocused();

		await page
			.getByRole('button', {name: 'open terminal', exact: true})
			.click();
		const terminal = page.locator('.terminal-panel');
		await expect(terminal).toBeVisible();
		await terminal.locator('.xterm-helper-textarea').focus();
		await page.keyboard.press(findKey);
		await expect(transcriptBar(page)).toHaveCount(0);
		await expect(diffBar(page)).toHaveCount(0);
		await page.getByRole('button', {name: 'close terminal panel'}).click();

		await page.getByRole('tab', {name: 'browser'}).click();
		const address = page.getByRole('textbox', {name: 'address', exact: true});
		await expect(address).toBeVisible();
		await address.focus();
		await page.keyboard.press(findKey);
		await expect(transcriptBar(page)).toHaveCount(0);
		await expect(diffBar(page)).toHaveCount(0);

		const result = {
			fixture: '2,505 replaced lines; 5,015 parsed rows; 5,000-row cap',
			query: 'line',
			matches: total,
			queryMs: round(queryMs),
			stepMs: round(stepMs),
			mountedRows,
		};
		mkdirSync(evidence, {recursive: true});
		writeFileSync(
			path.join(evidence, 'diff-find-performance.json'),
			`${JSON.stringify(result, null, 2)}\n`,
		);
		console.info(`DIFF_FIND_PERFORMANCE ${JSON.stringify(result)}`);
	} finally {
		await closeSession(session);
	}
});

test('#105 transcript find keeps 300 streamed updates responsive (PERF-04, FIND_STREAM_PERFORMANCE)', async () => {
	test.setTimeout(120_000);
	const session = await openSession('streaming');
	const {page} = session;
	try {
		await page.evaluate(() => {
			const probe: FindProbe = {
				updates: 0,
				firstUpdate: 0,
				lastUpdate: 0,
				frameGaps: [],
				inputFrameMs: [],
				eventLoopMs: [],
				stop: false,
			};
			const state = window as unknown as ProbeWindow;
			state.findProbe = probe;
			state.desktop.onProjectEvent(event => {
				if (event.type !== 'turn') return;
				for (const update of event.events) {
					if (update.type !== 'text' || !/^item \d+\n\n$/.test(update.text))
						continue;
					if (!probe.updates) probe.firstUpdate = performance.now();
					probe.updates++;
					probe.lastUpdate = performance.now();
				}
			});
			const channel = new MessageChannel();
			channel.port1.onmessage = event => {
				if (!probe.stop)
					probe.eventLoopMs.push(performance.now() - Number(event.data));
			};
			let lastFrame = 0;
			const frame = (at: number) => {
				if (probe.stop) {
					channel.port1.close();
					channel.port2.close();
					return;
				}
				if (probe.updates > 20) {
					if (lastFrame) probe.frameGaps.push(at - lastFrame);
					lastFrame = at;
					channel.port2.postMessage(performance.now());
				}
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
		await ask(page, 'stream performance fixture');
		await expect.poll(() => probeUpdates(page)).toBeGreaterThanOrEqual(15);
		await composer(page).focus();
		await page.keyboard.press(findKey);
		const input = transcriptInput(page);
		await expect(input).toBeFocused();
		await page.evaluate(() => {
			const probe = (window as unknown as ProbeWindow).findProbe;
			document
				.querySelector('.find-bar input')
				?.addEventListener('input', () => {
					if (!probe.updates || probe.stop) return;
					const started = performance.now();
					requestAnimationFrame(() =>
						probe.inputFrameMs.push(performance.now() - started),
					);
				});
		});
		// "item" matches every streamed line, so the match count grows with the stream.
		await input.fill('item');
		await expect(transcriptStatus(page)).toHaveText(
			/^1 of \d+ · loaded transcript$/,
		);
		const scrollMs: number[] = [];
		const counts = Array.from({length: 20}, (_, index) => 15 + index * 12);
		for (const count of counts) {
			await expect.poll(() => probeUpdates(page)).toBeGreaterThanOrEqual(count);
			await input.fill(count % 2 ? 'item' : 'item ');
			scrollMs.push(await scrollFrame(page));
		}
		await expect(turnEnded(page)).toBeVisible();
		const probe = await page.evaluate(() => {
			const state = (window as unknown as ProbeWindow).findProbe;
			state.stop = true;
			return state;
		});
		const updatesPerSecond =
			(probe.updates - 1) / ((probe.lastUpdate - probe.firstUpdate) / 1000);
		const metrics = {
			updates: probe.updates,
			updatesPerSecond: round(updatesPerSecond),
			frames: probe.frameGaps.length,
			maxFrameGapMs: round(Math.max(...probe.frameGaps)),
			medianFrameGapMs: round(percentile(probe.frameGaps, 0.5)),
			p95FrameGapMs: round(percentile(probe.frameGaps, 0.95)),
			inputSamples: probe.inputFrameMs.length,
			maxInputFrameMs: round(Math.max(...probe.inputFrameMs)),
			medianInputFrameMs: round(percentile(probe.inputFrameMs, 0.5)),
			p95InputFrameMs: round(percentile(probe.inputFrameMs, 0.95)),
			scrollSamples: scrollMs.length,
			maxScrollFrameMs: round(Math.max(...scrollMs)),
			medianScrollFrameMs: round(percentile(scrollMs, 0.5)),
			p95ScrollFrameMs: round(percentile(scrollMs, 0.95)),
			maxEventLoopMs: round(Math.max(...probe.eventLoopMs)),
		};
		mkdirSync(evidence, {recursive: true});
		writeFileSync(
			path.join(evidence, 'find-stream-performance.json'),
			`${JSON.stringify(metrics, null, 2)}\n`,
		);
		console.info(`FIND_STREAM_PERFORMANCE ${JSON.stringify(metrics)}`);
		expect(probe.updates).toBe(300);
		expect(updatesPerSecond).toBeGreaterThanOrEqual(100);
		expect(metrics.inputSamples).toBeGreaterThanOrEqual(20);
		expect(metrics.scrollSamples).toBeGreaterThanOrEqual(20);
		for (const latency of [
			metrics.medianFrameGapMs,
			metrics.p95FrameGapMs,
			metrics.medianInputFrameMs,
			metrics.p95InputFrameMs,
			metrics.medianScrollFrameMs,
			metrics.p95ScrollFrameMs,
			metrics.maxEventLoopMs,
		])
			expect(latency).toBeLessThan(100);
		await expect(transcriptStatus(page)).toHaveText(
			`1 of 300 · ${transcriptScope}`,
		);
		await expect(page.locator('.stream-markdown mark')).toHaveCount(0);
		expect(await highlightState(page)).toMatchObject({active: 1});
	} finally {
		await closeSession(session);
	}
});

test('#106 a failed turn row stays beside its turn after the thread is rebuilt from a snapshot', async () => {
	test.setTimeout(90_000);
	const session = await openSession('prompt-error');
	const {page} = session;
	try {
		await ask(page, 'failed turn one');
		await expect(page.locator('.gate-message-failure')).toHaveCount(1);
		await ask(page, 'failed turn two');
		await expect(page.locator('.gate-message-failure')).toHaveCount(2);
		const order = ['user', 'failure', 'user', 'failure'];
		await expect.poll(() => conversationOrder(page)).toEqual(order);

		// Leaving the thread and coming back asks main for a fresh snapshot.
		await page.getByRole('button', {name: 'new thread', exact: true}).click();
		const dialog = page.getByRole('dialog', {name: 'new thread', exact: true});
		await dialog
			.getByRole('button', {name: 'keep as new thread draft', exact: true})
			.click();
		await expect(dialog).toBeHidden();
		await page
			.getByRole('region', {name: 'project threads'})
			.getByRole('button', {name: /^failed turn one · /})
			.click();
		await expect(page.locator('.gate-message-failure')).toHaveCount(2);
		await expect.poll(() => conversationOrder(page)).toEqual(order);
	} finally {
		await closeSession(session);
	}
});
