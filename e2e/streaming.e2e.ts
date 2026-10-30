import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
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
import {visibleTextContrast} from './qa/ui-contrast';

const root = path.resolve(import.meta.dirname, '..');
const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-stream-')),
);
const evidence = path.join(root, '.qa/wave-3');
let app: ElectronApplication;
let page: Page;
const remoteRequests: string[] = [];

interface Probe {
	updates: number;
	firstUpdate: number;
	lastUpdate: number;
	frameGaps: number[];
	inputFrameMs: number[];
	eventLoopMs: number[];
	announcements: Array<{text: string; at: number; updates: number}>;
	stop: boolean;
}

interface StreamWindow extends Window {
	streamProbe: Probe;
	desktop: DesktopApi;
}

test.beforeAll(async () => {
	mkdirSync(evidence, {recursive: true});
	const fakeCli = path.join(work, 'nanocoder/dist/cli.js');
	const project = path.join(work, 'project');
	mkdirSync(path.dirname(fakeCli), {recursive: true});
	mkdirSync(project);
	writeFileSync(path.join(project, '.fake-nanocoder'), 'streaming');
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
		fakeCli,
	);
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {
			cliPath: fakeCli,
			nodePath: process.execPath,
		}),
	});
	page = await app.firstWindow();
	expect(page.url()).toMatch(/^app:\/\/renderer\//);
	page.on('request', request => {
		if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
	});
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
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

test('100 updates per second keep ordered content and input and scroll response within 100ms (PERF-04)', async () => {
	expect(page.url()).toMatch(/^app:\/\/renderer\//);
	await page.evaluate(() => {
		const state = window as unknown as StreamWindow;
		const probe: Probe = {
			updates: 0,
			firstUpdate: 0,
			lastUpdate: 0,
			frameGaps: [],
			inputFrameMs: [],
			eventLoopMs: [],
			announcements: [],
			stop: false,
		};
		state.streamProbe = probe;
		const region = document.querySelector(
			'[role="status"][aria-label="stream announcements"]',
		);
		if (!region) throw new Error('Missing polite stream announcement region');
		new MutationObserver(() => {
			if (!probe.stop && region.textContent)
				probe.announcements.push({
					text: region.textContent,
					at: performance.now(),
					updates: probe.updates,
				});
		}).observe(region, {subtree: true, childList: true, characterData: true});
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
		document
			.querySelector('textarea[placeholder="ask anything…"]')
			?.addEventListener('input', () => {
				if (!probe.updates || probe.stop) return;
				const started = performance.now();
				requestAnimationFrame(() =>
					probe.inputFrameMs.push(performance.now() - started),
				);
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
	const input = page.getByRole('textbox', {name: 'message', exact: true});
	await input.fill('stream performance fixture');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	const scrollMs: number[] = [];
	for (const count of [30, 75, 120, 165, 210]) {
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as StreamWindow).streamProbe.updates,
				),
			)
			.toBeGreaterThanOrEqual(count);
		await expect(input).toBeEnabled();
		await expect(
			page.getByRole('button', {name: 'send', exact: true}),
		).toBeDisabled();
		await input.fill(`draft-memory-only-${count}`);
		scrollMs.push(
			await page.evaluate(
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
								requestAnimationFrame(() =>
									resolve(performance.now() - started),
								),
							{once: true},
						);
						scroller.scrollTop =
							scroller.scrollTop > 0 ? 0 : scroller.scrollHeight;
					}),
			),
		);
	}
	await expect(
		page.getByText('turn ended: end_turn', {exact: true}),
	).toBeVisible();
	await expect(
		page.locator('[role="status"][aria-label="stream announcements"]'),
	).toContainText('turn completed. response finished:');
	const probe = await page.evaluate(() => {
		const probe = (window as unknown as StreamWindow).streamProbe;
		probe.stop = true;
		return probe;
	});
	const updatesPerSecond =
		(probe.updates - 1) / ((probe.lastUpdate - probe.firstUpdate) / 1000);
	const metrics = {
		updates: probe.updates,
		updatesPerSecond,
		maxFrameGapMs: Math.max(...probe.frameGaps),
		maxInputFrameMs: Math.max(...probe.inputFrameMs),
		maxScrollFrameMs: Math.max(...scrollMs),
		maxEventLoopMs: Math.max(...probe.eventLoopMs),
		frames: probe.frameGaps.length,
		inputSamples: probe.inputFrameMs.length,
		scrollSamples: scrollMs.length,
		announcementWrites: probe.announcements.length,
		announcementElapsedMs:
			(probe.announcements.at(-1)?.at ?? 0) - (probe.announcements[0]?.at ?? 0),
		minAnnouncementGapMs: Math.min(
			...probe.announcements
				.slice(1)
				.map((entry, index) => entry.at - probe.announcements[index].at),
		),
	};
	writeFileSync(
		path.join(evidence, 'stream-performance.json'),
		JSON.stringify(metrics, null, 2),
	);
	console.info('PERF-04', JSON.stringify(metrics));
	expect(probe.updates).toBe(300);
	expect(probe.announcements.length).toBeLessThanOrEqual(
		Math.ceil(metrics.announcementElapsedMs / 1000) + 1,
	);
	expect(probe.announcements[0].text).toBe('turn started');
	expect(metrics.minAnnouncementGapMs).toBeGreaterThanOrEqual(1000);
	expect(
		probe.announcements.some(entry =>
			entry.text.startsWith('turn completed. response finished:'),
		),
	).toBe(true);
	for (const entry of probe.announcements) {
		expect(
			entry.text === 'turn started' ||
				entry.text.startsWith('turn completed. response finished:'),
		).toBe(true);
		if (entry.updates < probe.updates) expect(entry.text).toBe('turn started');
	}
	expect(updatesPerSecond).toBeGreaterThanOrEqual(100);
	expect(updatesPerSecond).toBeLessThanOrEqual(115);
	expect(metrics.frames).toBeGreaterThan(60);
	expect(metrics.inputSamples).toBe(5);
	for (const latency of [
		metrics.maxFrameGapMs,
		metrics.maxInputFrameMs,
		metrics.maxScrollFrameMs,
		metrics.maxEventLoopMs,
	])
		expect(latency).toBeLessThanOrEqual(100);
	const agent = page.locator('.gate-message-agent');
	await expect(agent.locator('p').filter({hasText: /^item \d+$/})).toHaveText(
		Array.from({length: 300}, (_, index) => `item ${index + 1}`),
	);
	await expect(page.locator('.stream-token-chip')).toHaveText('+400 tok');
	await expect(
		page
			.locator('.conversation-stream')
			.getByRole('progressbar', {name: 'reported context use'}),
	).toHaveAttribute('aria-valuenow', '13');
	await expect(
		page
			.locator('.composer')
			.getByRole('progressbar', {name: 'reported context use'}),
	).toHaveAttribute('aria-valuenow', '13');
	await expect(page.locator('.conversation-stream')).not.toContainText(
		'synthetic-private',
	);
	await expect(
		page.locator(
			'.conversation-stream img, .conversation-stream a, .conversation-stream script, .conversation-stream iframe',
		),
	).toHaveCount(0);
	expect(remoteRequests).toEqual([]);
	const before = await agent.textContent();
	await app.evaluate(
		({BrowserWindow}, channel) =>
			BrowserWindow.getAllWindows()[0].webContents.send(channel, {
				type: 'text',
				text: 'duplicate legacy fixture',
			}),
		'nanocoder:event',
	);
	const bridgeKeys = await page.evaluate(async () => {
		const {desktop} = window as unknown as StreamWindow;
		await desktop.getAppInfo();
		return Object.keys(desktop);
	});
	expect(bridgeKeys).not.toContain('onNanocoderEvent');
	await expect(agent).toHaveText(before ?? '');
	await expect(input).toHaveValue('draft-memory-only-210');
	for (const file of ['desktop.sqlite', 'desktop.sqlite-wal']) {
		const target = path.join(work, 'profile', file);
		if (existsSync(target))
			expect(
				readFileSync(target).includes(Buffer.from('draft-memory-only')),
			).toBe(false);
	}
	await input.fill('/rev');
	await page
		.getByRole('button', {name: 'insert /review into message', exact: true})
		.click();
	await expect(input).toHaveValue('/review ');
	await expect(input).toBeFocused();
	await expect(page.locator('.gate-message-user')).toHaveCount(1);
});

test('stream semantics keyboard disclosure reduced motion and both themes at three widths (CHAT-05 CHAT-19 CHAT-20)', async () => {
	expect(page.url()).toMatch(/^app:\/\/renderer\//);
	const input = page.getByRole('textbox', {name: 'message', exact: true});
	await input.fill('second visual fixture');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect(page.locator('.stream-cursor')).toBeVisible();
	await page.emulateMedia({reducedMotion: 'reduce'});
	await expect(page.locator('.stream-cursor')).toHaveCSS(
		'animation-name',
		'none',
	);
	await expect(page.locator('.gate-message-tool .spinner')).toHaveCSS(
		'animation-name',
		'none',
	);
	await expect(page.locator('.gate-message-thought').last()).toHaveCSS(
		'border-left-style',
		'dashed',
	);
	await expect(page.locator('.stream-reasoning').last()).toHaveCSS(
		'font-style',
		'italic',
	);
	await expect(page.locator('.stream-reasoning').last()).toHaveCSS(
		'font-synthesis',
		'style',
	);
	await expect(page.locator('.gate-message-user').last()).toHaveCSS(
		'border-left-width',
		'2px',
	);
	await expect(
		page.getByText('turn ended: end_turn', {exact: true}),
	).toBeVisible();
	await expect(page.locator('.stream-cursor')).toHaveCount(0);
	const toolDetails = page.locator('.gate-message-tool details');
	await expect(toolDetails).toHaveCount(2);
	await expect(toolDetails.first()).toContainText('fixture tool detail');
	const currentToolDetails = toolDetails.last();
	const disclosure = currentToolDetails.locator('summary');
	await disclosure.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(disclosure).toBeFocused();
	await expect(disclosure).toHaveCSS('outline-width', '2px');
	await disclosure.press('Enter');
	await expect(
		currentToolDetails.getByText('fixture tool detail', {exact: true}),
	).toBeVisible();
	await expect(
		toolDetails.first().getByText('fixture tool detail', {exact: true}),
	).toBeHidden();
	for (const theme of ['dark', 'light']) {
		for (const width of [1240, 1020, 840]) {
			expect(page.url()).toMatch(/^app:\/\/renderer\//);
			await page.setViewportSize({width, height: 900});
			await page.evaluate(value => {
				document.documentElement.dataset.theme = value;
			}, theme);
			await page.locator('.gate-message-user').last().scrollIntoViewIfNeeded();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			const failures = await visibleTextContrast(page, theme);
			expect(failures).toEqual([]);
			await page.screenshot({
				path: path.join(evidence, `stream-${theme}-${width}.png`),
			});
		}
	}
});
