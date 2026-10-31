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
import {build} from 'vite';
import type {DesktopApi} from '@/shared/desktop-api';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import type {mountShellFixture} from './qa/shell-harness';
import {visibleTextContrast} from './qa/ui-contrast';

const work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-shell-')));
const cli = path.join(work, 'nanocoder/dist/cli.js');
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
	mkdirSync(path.dirname(cli), {recursive: true});
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
	page = await app.firstWindow();
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

function project(name: string, mode = 'ok'): string {
	const folder = path.join(work, name);
	mkdirSync(folder);
	writeFileSync(path.join(folder, '.fake-nanocoder'), mode);
	return folder;
}

async function open(folder: string | null) {
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: folder === null,
			filePaths: folder ? [folder] : [],
		})) as typeof dialog.showOpenDialog;
	}, folder);
	await page.getByRole('button', {name: 'open a project folder'}).click();
	await expect(
		page.getByRole('button', {name: 'open a project folder'}),
	).toBeEnabled();
	if (folder)
		await expect(
			page.getByRole('region', {name: 'connected agent', includeHidden: true}),
		).toContainText(folder);
}

test('ACP badge follows child exit, not unrelated provider failure, in both themes', async () => {
	for (const theme of ['dark', 'light']) {
		await page.emulateMedia({reducedMotion: 'reduce'});
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		const folder = project(`exit-${theme}`, 'die-in-turn');
		await open(folder);
		await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
		await page.getByRole('textbox', {name: 'message'}).fill('fixture exit');
		await page.getByRole('button', {name: 'send', exact: true}).click();
		await expect(page.getByRole('alert')).toContainText(
			'Nanocoder stopped during the turn',
		);
		await expect(page.locator('.ui-badge--failed')).toBeVisible();
		await expect(page.locator('.ui-badge--acp-exited')).toHaveText(
			'○ acp · exited (3)',
		);
		await expect(page.locator('.ui-badge--success')).toHaveCount(0);
		await open(project(`provider-${theme}`, 'prompt-error'));
		await page
			.getByRole('textbox', {name: 'message'})
			.fill('fixture provider error');
		await page.getByRole('button', {name: 'send', exact: true}).click();
		await expect(page.getByRole('alert')).toContainText(
			'could not finish the turn',
		);
		await expect(page.locator('.ui-badge--failed')).toBeVisible();
		await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
		await expect(page.locator('.ui-badge--acp-exited')).toHaveCount(0);
		writeFileSync(path.join(folder, '.fake-nanocoder'), 'ok');
		await open(folder);
		await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	}
});

test('ACP badge stays scoped when a picker is cancelled or another project stops', async () => {
	await page.evaluate(() => {
		const roots = new Map<string, string>();
		Object.assign(window, {shellProjectIds: roots});
		(window as unknown as {desktop: DesktopApi}).desktop.onProjectEvent(
			event => {
				if (event.type === 'supervisor' && event.state.agent)
					roots.set(event.state.agent.root, event.projectId);
			},
		);
	});
	const first = project('scoped-a');
	await open(first);
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	await open(null);
	await expect(
		page.getByRole('region', {name: 'connected agent', includeHidden: true}),
	).toContainText(first);
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	const second = project('scoped-b');
	await open(second);
	const result = await page.evaluate(async root => {
		const projectId = (
			window as unknown as {shellProjectIds: Map<string, string>}
		).shellProjectIds.get(root);
		if (!projectId) throw new Error('Missing scoped project');
		return (window as unknown as {desktop: DesktopApi}).desktop.stopProject({
			projectId,
		});
	}, first);
	expect(result.ok).toBe(true);
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	await expect(page.locator('.ui-badge--acp-exited')).toHaveCount(0);
});

test('ACP readiness is replayed on reopening after a renderer reload', async () => {
	const folder = project('replay');
	await open(folder);
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	await page.reload();
	await expect(page.locator('.ui-badge--acp-ready')).toHaveCount(0);
	await open(folder);
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
});

test('shell geometry and pinned composer follow all three widths without an empty inspector', async () => {
	await open(project('layout'));
	await page.emulateMedia({reducedMotion: 'reduce'});
	await page.evaluate(() => {
		const fixture = document.createElement('div');
		fixture.id = 'shell-layout-fixture';
		fixture.style.height = '2000px';
		document.querySelector('.technical-gate')?.append(fixture);
	});
	try {
		for (const theme of ['dark', 'light']) {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			for (const width of [1240, 1020, 840, 841, 839]) {
				await page.setViewportSize({width, height: 900});
				await expect(page.locator('.shell-workbench')).toHaveCount(0);
				const geometry = await page.evaluate(() => {
					const measure = (selector: string) => {
						const element = document.querySelector(selector);
						if (!element) throw new Error('Missing shell region');
						const rect = element.getBoundingClientRect();
						return {x: rect.x, width: rect.width, bottom: rect.bottom};
					};
					const scroll = document.querySelector('.shell-stream-scroll');
					if (!scroll) throw new Error('Missing stream scroll region');
					scroll.scrollTop = scroll.scrollHeight;
					return {
						rail: measure('.shell-project-rail'),
						stream: measure('.shell-stream'),
						composer: measure('.gate-composer'),
						scrolls: scroll.scrollHeight > scroll.clientHeight,
						overflows: document.documentElement.scrollWidth > innerWidth,
					};
				});
				const railWidth = width <= 840 ? 188 : width <= 1050 ? 204 : 222;
				expect(geometry.rail.width).toBe(railWidth);
				expect(geometry.stream.x).toBe(railWidth);
				expect(geometry.stream.width).toBe(width - railWidth);
				expect(geometry.composer.bottom).toBe(
					width <= 840 ? 883 : width <= 1050 ? 882 : 880,
				);
				expect(geometry.scrolls).toBe(true);
				expect(geometry.overflows).toBe(false);
				expect(await visibleTextContrast(page, theme)).toEqual([]);
			}
		}
	} finally {
		await page.evaluate(() =>
			document.getElementById('shell-layout-fixture')?.remove(),
		);
	}
});

test('the compact shell exposes real controls and omits unused later surfaces', async () => {
	await page.setViewportSize({width: 1240, height: 900});
	await expect(page.getByRole('banner')).not.toContainText('not built yet');
	await expect(
		page.getByRole('banner').getByRole('button', {name: 'command palette'}),
	).toBeVisible();
	const threads = page.getByRole('region', {name: 'project threads'});
	await expect(
		threads.getByRole('button', {name: 'new thread', exact: true}),
	).toBeEnabled();
	await expect(
		threads.locator('.thread-open[aria-current="true"]'),
	).toHaveCount(1);
	await expect(
		page.locator('.shell-workbench,.shell-bottom-panel,.shell-placeholder'),
	).toHaveCount(0);
	const switcher = page.getByLabel('switch project', {exact: true});
	await switcher.click();
	await expect(
		page.getByRole('region', {name: 'recent projects'}),
	).toBeVisible();
	await switcher.click();
});
test('keyboard controls remain reachable and visibly focused inside the stream in both themes and all widths', async () => {
	for (const theme of ['dark', 'light']) {
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		for (const width of [1240, 1020, 840]) {
			await page.setViewportSize({width, height: 900});
			const open = page.getByRole('button', {name: 'open a project folder'});
			const input = page.getByRole('textbox', {name: 'message'});
			const palette = page.getByRole('button', {
				name: 'command palette',
				exact: true,
			});
			await palette.focus();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Shift+Tab');
			await expect(palette).toBeFocused();
			await expect(palette).toHaveCSS('outline-width', '2px');
			const recent = page.getByRole('region', {name: 'recent projects'});
			const add = recent.getByRole('button', {
				name: 'add project folder',
				exact: true,
			});
			const switcher = page.getByLabel('switch project', {exact: true});
			await page.locator('.project-switcher').evaluate(element => {
				(element as HTMLDetailsElement).open = true;
			});
			await expect(recent).toBeVisible();
			const projects = recent.getByRole('listitem');
			expect(await projects.count()).toBeGreaterThan(0);
			const rail = page.getByRole('region', {name: 'project threads'});
			const diagnostics = page.getByRole('button', {
				name: 'diagnostics',
				exact: true,
			});
			const send = page.getByRole('button', {name: 'send', exact: true});
			const focusOrder = [
				switcher,
				add,
				...(await projects.all()).flatMap(project =>
					[/^open /, /^locate /].map(name =>
						project.getByRole('button', {name}),
					),
				),
				rail.getByRole('button', {name: 'new thread', exact: true}),
				...(await rail.locator('.thread-row').all()).flatMap(thread => [
					thread.locator('.thread-open'),
					thread.locator('.thread-actions > summary'),
				]),
				page.getByRole('button', {name: 'refresh saved sessions', exact: true}),
				page.getByRole('button', {
					name: 'import saved session: existing saved session',
					exact: true,
				}),
				page.getByRole('button', {name: 'open terminal', exact: true}),
				palette,
				page.getByText('runtime and setup details', {exact: true}),
				open,
				diagnostics,
				input,
				page.getByRole('combobox', {name: 'mode for this thread', exact: true}),
				send,
			];
			await focusOrder[0].focus();
			for (const [index, control] of focusOrder.entries()) {
				if (index > 0) await page.keyboard.press('Tab');
				await expect(control).toBeFocused();
				await expect(control).toHaveCSS('outline-width', '2px');
				if (control === input) {
					await expect(page.locator('.gate-composer')).toHaveCSS(
						'border-color',
						theme === 'dark' ? 'rgb(122, 162, 247)' : 'rgb(0, 0, 238)',
					);
					await input.fill('fixture keyboard check');
				}
			}
			await page.keyboard.press('Enter');
			const permission = page.getByRole('region', {name: 'permission request'});
			const allow = permission.getByRole('button', {
				name: 'Allow',
				exact: true,
			});
			const deny = permission.getByRole('button', {name: 'Deny', exact: true});
			await expect(allow).toBeVisible();
			await allow.focus();
			await page.keyboard.press('Tab');
			await expect(deny).toBeFocused();
			await expect(deny).toHaveCSS('outline-width', '2px');
			await page.keyboard.press('Enter');
			await expect(permission).toHaveCount(0);
			await expect(page.getByText('turn ended: end_turn')).toBeVisible();
			await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
		}
	}
});

test('the mounted workbench takes the narrow canvas and returns to the same chat draft', async () => {
	page.setDefaultTimeout(5000);
	const fixtureErrors: string[] = [];
	page.on('pageerror', error => fixtureErrors.push(error.message));
	const result = await build({
		configFile: false,
		logLevel: 'silent',
		define: {'process.env.NODE_ENV': JSON.stringify('production')},
		resolve: {alias: {'@': path.resolve('source')}},
		build: {
			write: false,
			minify: false,
			lib: {
				entry: path.resolve('e2e/qa/shell-harness.ts'),
				name: 'shellFixture',
				formats: ['iife'],
			},
		},
	});
	const outputs = Array.isArray(result) ? result : [result];
	const code = outputs
		.flatMap(output => ('output' in output ? output.output : []))
		.filter(chunk => chunk.type === 'chunk')
		.map(chunk => chunk.code)
		.join('\n');
	await page.evaluate(code);
	await page.evaluate(() => {
		const state = window as unknown as {
			shellFixture: {mountShellFixture: typeof mountShellFixture};
			unmountShell: () => void;
		};
		state.unmountShell = state.shellFixture.mountShellFixture();
	});
	try {
		for (const theme of ['dark', 'light']) {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			expect(
				await page.getByRole('button', {name: 'open fixture panel'}).count(),
				fixtureErrors.join('\n'),
			).toBe(1);
			for (const width of [1240, 1020, 841, 840, 839]) {
				await page.setViewportSize({width, height: 900});
				const typedDraft = `typed ${theme} ${width} draft`;
				await page
					.getByRole('textbox', {name: 'fixture draft'})
					.fill(typedDraft);
				const opener = page.getByRole('button', {name: 'open fixture panel'});
				await opener.focus();
				await page.keyboard.press('Enter');
				const panel = page.getByRole('complementary', {
					name: 'fixture workbench',
				});
				await expect(panel).toBeVisible();
				const chat = page.getByRole('main', {name: 'conversation workspace'});
				const draft = page.getByRole('textbox', {
					name: 'fixture draft',
					includeHidden: true,
				});
				await expect(draft).toHaveValue(typedDraft);
				if (width <= 840) {
					await expect(chat).toBeHidden();
					const railWidth = 188;
					expect((await panel.boundingBox())?.width).toBe(width - railWidth);
				} else await expect(chat).toBeVisible();
				const close = panel.getByRole('button', {
					name: width <= 840 ? '← back to chat' : 'close panel',
					exact: true,
				});
				await close.focus();
				await expect(close).toHaveCSS('outline-width', '2px');
				await page.keyboard.press('Enter');
				await expect(panel).toHaveCount(0);
				await expect(opener).toBeFocused();
				await expect(chat).toBeVisible();
				await expect(draft).toHaveValue(typedDraft);
				expect(await visibleTextContrast(page, theme)).toEqual([]);
			}
		}
	} finally {
		await page.evaluate(() =>
			(window as unknown as {unmountShell(): void}).unmountShell(),
		);
	}
});
