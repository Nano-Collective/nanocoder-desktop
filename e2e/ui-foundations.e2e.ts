import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
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
import {contrast, visibleTextContrast} from './qa/ui-contrast';

const work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-ui-')));
const cli = path.join(work, 'nanocoder/dist/cli.js');
const project = path.join(work, 'project');
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
	mkdirSync(path.dirname(cli), {recursive: true});
	mkdirSync(project);
	copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', cli);
	writeFileSync(
		path.join(work, 'nanocoder/package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
	}, project);
	page = await app.firstWindow();
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

test('Fira Code loads from bundled app resources, with no network requests', async () => {
	const requests: string[] = [];
	page.on('request', request => requests.push(request.url()));
	await page.reload();
	const fonts = await page.evaluate(async () => {
		await document.fonts.ready;
		const sources = [...document.styleSheets].flatMap(sheet =>
			[...sheet.cssRules].flatMap(rule =>
				rule instanceof CSSFontFaceRule
					? [
							...rule.style
								.getPropertyValue('src')
								.matchAll(/url\(["']?([^"')]+)["']?\)/g),
						].map(([, url]) => new URL(url, sheet.href ?? location.href).href)
					: [],
			),
		);
		const response = await fetch(sources[0]);
		return {
			loaded: [...document.fonts].some(
				face => face.family === 'Fira Code' && face.status === 'loaded',
			),
			family: getComputedStyle(document.body).fontFamily,
			resources: sources,
			bundledFont: {
				status: response.status,
				bytes: (await response.arrayBuffer()).byteLength,
			},
		};
	});
	expect(fonts.loaded).toBe(true);
	expect(fonts.family).toContain('"Fira Code"');
	expect(fonts.resources.length).toBeGreaterThan(0);
	expect(fonts.bundledFont.status).toBe(200);
	expect(fonts.bundledFont.bytes).toBeGreaterThan(1000);
	for (const resource of fonts.resources) {
		expect(resource).toMatch(/^app:\/\/renderer\/assets\/fira-code-/);
	}
	expect(requests.filter(url => /^https?:/.test(url))).toEqual([]);
	await expect(page.locator('html')).toHaveCSS(
		'background-color',
		'rgb(22, 22, 22)',
	);
});

test('the production CSP refuses remote font requests', async () => {
	const failed = page.waitForEvent('requestfailed', {
		predicate: request =>
			request.url() === 'https://example.invalid/refused.woff2',
	});
	const violation = await page.evaluate(async () => {
		const blocked = new Promise<{directive: string; uri: string}>(resolve => {
			document.addEventListener(
				'securitypolicyviolation',
				event => {
					if (event.effectiveDirective === 'font-src') {
						resolve({
							directive: event.effectiveDirective,
							uri: event.blockedURI,
						});
					}
				},
				{once: true},
			);
		});
		const font = new FontFace(
			'refused-remote-font',
			'url(https://example.invalid/refused.woff2)',
		);
		const result = await font.load().then(
			() => 'loaded',
			() => 'refused',
		);
		return {result, ...(await blocked)};
	});
	expect(violation).toEqual({
		result: 'refused',
		directive: 'font-src',
		uri: 'https://example.invalid/refused.woff2',
	});
	const request = await failed;
	expect(request.failure()?.errorText).toMatch(
		/^(csp|net::ERR_BLOCKED_BY_CSP)$/,
	);
	expect(await request.response()).toBeNull();
});

test('both themes apply and keep the technical gate readable at all three widths', async () => {
	await page.emulateMedia({reducedMotion: 'reduce'});
	for (const theme of ['light', 'dark']) {
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		await expect(page.locator('html')).toHaveCSS(
			'background-color',
			theme === 'light' ? 'rgb(245, 246, 251)' : 'rgb(22, 22, 22)',
		);
		await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
		for (const width of [1240, 1020, 840]) {
			await page.setViewportSize({width, height: 900});
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			expect(await visibleTextContrast(page, theme)).toEqual([]);
		}
	}
	await page.emulateMedia({reducedMotion: 'no-preference'});
	await expect(page.getByRole('button').first()).toHaveCSS(
		'transition-duration',
		'0s',
	);
});

test('keyboard focus is visible on buttons and the message input', async () => {
	const open = page.getByRole('button', {name: 'open a project folder'});
	await open.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(open).toBeFocused();
	await expect(open).toHaveCSS('outline-style', 'solid');
	await expect(open).toHaveCSS('outline-width', '2px');
	await page.keyboard.press('Enter');
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	const switcher = page.getByLabel('switch project', {exact: true});
	if (!(await page.locator('.project-switcher').getAttribute('open'))) {
		await page.locator('.project-switcher').evaluate(element => {
			(element as HTMLDetailsElement).open = true;
		});
	}
	const recent = page.getByRole('region', {name: 'recent projects'});
	await expect(
		recent.getByRole('button', {name: 'open project', exact: true}),
	).toBeEnabled();
	const palette = page.getByRole('button', {
		name: 'command palette',
		exact: true,
	});
	const rail = page.getByRole('region', {name: 'project threads'});
	const diagnostics = page.getByRole('button', {
		name: 'diagnostics',
		exact: true,
	});
	const input = page.getByRole('textbox', {name: 'message'});
	const send = page.getByRole('button', {name: 'send', exact: true});
	const focusOrder = [
		switcher,
		...['add project folder', 'open project', 'locate project'].map(name =>
			recent.getByRole('button', {name, exact: true}),
		),
		rail.getByRole('button', {name: 'new thread', exact: true}),
		rail.locator('.thread-open'),
		rail.locator('.thread-actions > summary'),
		page.getByRole('button', {name: 'refresh saved sessions', exact: true}),
		page.getByRole('button', {
			name: 'import saved session: existing saved session',
			exact: true,
		}),
		palette,
		page.getByText('runtime and setup details', {exact: true}),
		open,
		diagnostics,
		input,
		page.getByRole('combobox', {name: 'mode for this thread', exact: true}),
		send,
	];
	await expect(
		page.getByRole('button', {name: 'send', exact: true}),
	).toBeDisabled();
	await focusOrder[0].focus();
	for (const [index, control] of focusOrder.entries()) {
		if (index > 0) await page.keyboard.press('Tab');
		await expect(control).toBeFocused();
		await expect(control).toHaveCSS('outline-width', '2px');
		if (control === input) {
			await expect(input).toHaveAccessibleDescription(
				'enter a message to send',
			);
			await input.fill('synthetic UI check');
			await expect(input).toHaveAccessibleDescription(
				'⏎ send · ⇧⏎ newline · / commands',
			);
			await expect(send).toBeEnabled();
		}
	}
});

test('approval parts have named actions and no new contrast gaps in either theme', async () => {
	await page.getByRole('button', {name: 'send', exact: true}).click();
	const card = page.getByRole('region', {name: 'permission request'});
	await expect(card).toBeVisible();
	const dialog = card.getByRole('alertdialog');
	await expect(dialog).toBeFocused();
	await expect(card).toHaveCSS('outline-width', '2px');
	await expect(card).toHaveCSS('outline-style', 'solid');
	const switcher = page.getByLabel('switch project', {exact: true});
	const recent = page.getByRole('region', {name: 'recent projects'});
	const rail = page.getByRole('region', {name: 'project threads'});
	const focusOrder = [
		switcher,
		recent.getByRole('button', {name: 'add project folder', exact: true}),
		recent.getByRole('button', {name: 'open project', exact: true}),
		recent.getByRole('button', {name: 'locate project', exact: true}),
		rail.getByRole('button', {name: 'new thread', exact: true}),
		rail.locator('.thread-open'),
		rail.locator('.thread-actions > summary'),
		page.getByRole('button', {name: 'command palette', exact: true}),
		page.getByText('runtime and setup details', {exact: true}),
		page.getByRole('button', {name: 'open a project folder', exact: true}),
		page.getByRole('button', {name: 'diagnostics', exact: true}),
		card.getByRole('button', {name: 'Allow', exact: true}),
		card.getByRole('button', {name: 'Deny', exact: true}),
		page.getByRole('textbox', {name: 'message'}),
		page.getByRole('button', {name: 'cancel turn', exact: true}),
	];
	await focusOrder[0].focus();
	for (const [index, control] of focusOrder.entries()) {
		if (index > 0) await page.keyboard.press('Tab');
		await expect(control).toBeFocused();
		await expect(control).toHaveCSS('outline-width', '2px');
	}
	await expect(
		page.getByRole('button', {name: 'send', exact: true}),
	).toBeDisabled();
	await expect(
		page.getByRole('textbox', {name: 'message'}),
	).toHaveAccessibleDescription('waiting for Nanocoder to finish the turn');
	await expect(
		page.getByRole('status').filter({hasText: 'approval'}),
	).toBeVisible();
	await expect(
		card.getByRole('button', {name: 'Allow', exact: true}),
	).toHaveClass(/ui-button--allow/);
	await expect(
		card.getByRole('button', {name: 'Deny', exact: true}),
	).toHaveClass(/ui-button--reject/);
	await page.emulateMedia({reducedMotion: 'reduce'});
	for (const theme of ['dark', 'light']) {
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		expect(await visibleTextContrast(page, theme)).toEqual([]);
	}
	await card.getByRole('button', {name: 'Deny', exact: true}).click();
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
});

test('reduce motion stops spinner, cursor, approval pulse and colour transitions', async () => {
	await page.evaluate(() => {
		const fixture = document.createElement('div');
		fixture.id = 'motion-fixture';
		fixture.innerHTML =
			'<span class="spinner">◐ running</span><span class="stream-cursor">▌ streaming</span><section class="ui-card ui-card--approval">approval required</section>';
		document.body.append(fixture);
	});
	try {
		await page.emulateMedia({reducedMotion: 'no-preference'});
		await expect(page.locator('#motion-fixture .spinner')).toHaveCSS(
			'animation-duration',
			'1.1s',
		);
		await expect(page.locator('#motion-fixture .stream-cursor')).toHaveCSS(
			'animation-duration',
			'1s',
		);
		await expect(page.locator('#motion-fixture .ui-card')).toHaveCSS(
			'animation-duration',
			'2.2s',
		);
		await page.emulateMedia({reducedMotion: 'reduce'});
		for (const selector of ['.spinner', '.stream-cursor', '.ui-card']) {
			await expect(page.locator(`#motion-fixture ${selector}`)).toHaveCSS(
				'animation-name',
				'none',
			);
		}
		await expect(page.getByRole('button').first()).toHaveCSS(
			'transition-duration',
			'0s',
		);
	} finally {
		await page.evaluate(() =>
			document.getElementById('motion-fixture')?.remove(),
		);
	}
});

test('visible low-contrast key hints are caught even when hidden from assistive technology', async () => {
	await page.emulateMedia({reducedMotion: 'reduce'});
	await page.evaluate(() => {
		document.documentElement.dataset.theme = 'light';
		const button = document.createElement('button');
		button.id = 'hint-fixture';
		button.className = 'ui-button';
		button.innerHTML =
			'example <kbd class="ui-key-hint" aria-hidden="true">enter</kbd>';
		const hint = button.querySelector('kbd');
		if (hint) hint.style.opacity = '0.55';
		document.body.append(button);
	});
	try {
		const failures = await visibleTextContrast(page, 'light');
		expect(
			failures.some(sample => sample.text === 'enter' && sample.ratio < 4.5),
		).toBe(true);
	} finally {
		await page.evaluate(() =>
			document.getElementById('hint-fixture')?.remove(),
		);
	}
});

test('running and failed badge backgrounds and failure typography follow their component tokens', async () => {
	await page.emulateMedia({reducedMotion: 'reduce'});
	await page.evaluate(() => {
		const fixture = document.createElement('div');
		fixture.id = 'token-fixture';
		fixture.innerHTML =
			'<span class="ui-badge ui-badge--success ui-badge--running">● running</span><span class="ui-badge ui-badge--error ui-badge--failed">✕ failed</span><section class="ui-card ui-card--failure">✕ operation failed</section>';
		document.body.append(fixture);
	});
	try {
		for (const theme of ['dark', 'light']) {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			for (const state of ['running', 'failed']) {
				await expect(
					page.locator(`#token-fixture .ui-badge--${state}`),
				).toHaveCSS(
					'background-color',
					theme === 'light' ? 'rgb(235, 237, 245)' : 'rgb(22, 22, 22)',
				);
			}
			await expect(page.locator('#token-fixture .ui-card--failure')).toHaveCSS(
				'font-size',
				'11px',
			);
			await expect(page.locator('#token-fixture .ui-card--failure')).toHaveCSS(
				'line-height',
				'19.8px',
			);
			expect(await visibleTextContrast(page, theme)).toEqual([]);
		}
	} finally {
		await page.evaluate(() =>
			document.getElementById('token-fixture')?.remove(),
		);
	}
});

test('a child exit shows a failed turn without a stale ACP readiness claim in either theme', async () => {
	await page.emulateMedia({reducedMotion: 'reduce'});
	for (const theme of ['dark', 'light']) {
		const folder = path.join(work, `exit-${theme}`);
		mkdirSync(folder);
		writeFileSync(path.join(folder, '.fake-nanocoder'), 'die-in-turn');
		await app.evaluate(({dialog}, folder) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [folder],
			})) as typeof dialog.showOpenDialog;
		}, folder);
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		await page.getByRole('button', {name: 'open a project folder'}).click();
		await expect(
			page.getByRole('button', {name: 'open a project folder'}),
		).toBeEnabled();
		await expect(
			page.getByRole('region', {name: 'connected agent', includeHidden: true}),
		).toContainText(folder);
		await page
			.getByRole('textbox', {name: 'message'})
			.fill('synthetic exit check');
		await page.evaluate(() => {
			const state = window as unknown as {
				desktop: DesktopApi;
				exitStopped: Promise<unknown>;
			};
			state.exitStopped = new Promise(resolve => {
				const off = state.desktop.onProjectEvent(event => {
					if (event.type !== 'supervisor' || event.state.status !== 'failed')
						return;
					off();
					void state.desktop
						.stopProject({projectId: event.projectId})
						.then(resolve);
				});
			});
		});
		await page.getByRole('button', {name: 'send', exact: true}).click();
		await page.evaluate(
			() => (window as unknown as {exitStopped: Promise<unknown>}).exitStopped,
		);
		const failure = page.getByRole('alert');
		await expect(failure).toContainText('Nanocoder stopped during the turn');
		await expect(failure).toHaveCSS('font-size', '11px');
		await expect(
			page.getByRole('status').filter({hasText: 'failed'}),
		).toBeVisible();
		await expect(
			page
				.locator('.ui-badge[role="status"]')
				.filter({hasText: /ready|running|idle/}),
		).toHaveCount(0);
		await expect(page.locator('.ui-badge--success')).toHaveCount(0);
		await expect(page.locator('.ui-badge--failed')).toHaveCSS(
			'background-color',
			theme === 'light' ? 'rgb(235, 237, 245)' : 'rgb(22, 22, 22)',
		);
		await expect(page.getByRole('textbox', {name: 'message'})).toBeDisabled();
		await expect(
			page.getByRole('button', {name: 'send', exact: true}),
		).toBeDisabled();
		await expect(
			page.getByRole('button', {name: 'retry Nanocoder', exact: true}),
		).toBeEnabled();
		await expect(page.locator('.ui-badge--success')).toHaveCount(0);
		const selected = page.locator('.thread-row[data-selected="true"]');
		const glyph = selected.locator('.thread-status--error');
		await expect(glyph).toBeVisible();
		await expect(glyph).toHaveCSS(
			'color',
			theme === 'dark' ? 'rgb(247, 118, 142)' : 'rgb(161, 40, 76)',
		);
		await expect(selected).toHaveCSS(
			'background-color',
			theme === 'dark' ? 'rgb(32, 42, 59)' : 'rgb(220, 230, 250)',
		);
		await expect(selected).toHaveCSS(
			'border-left-color',
			theme === 'dark' ? 'rgb(122, 162, 247)' : 'rgb(0, 0, 238)',
		);
		const rendered = await glyph.evaluate(element => {
			const style = getComputedStyle(element);
			const rgb = (value: string) =>
				value
					.match(/[\d.]+/g)
					?.slice(0, 3)
					.map(Number) as [number, number, number];
			const owner = element.closest('.thread-row');
			if (!owner) throw new Error('Expected the selected thread row');
			const row = getComputedStyle(owner);
			return {
				foreground: rgb(style.color),
				background: rgb(
					style.backgroundColor === 'rgba(0, 0, 0, 0)'
						? row.backgroundColor
						: style.backgroundColor,
				),
			};
		});
		expect(
			contrast(rendered.foreground, rendered.background),
		).toBeGreaterThanOrEqual(4.5);
		await expect(selected).toHaveCSS('border-left-width', '2px');
		expect(await visibleTextContrast(page, theme)).toEqual([]);
	}
});
