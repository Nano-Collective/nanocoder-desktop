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
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import {qaEnvironment} from './qa/environment';
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
			page.getByRole('region', {name: 'connected agent'}),
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
		page.getByRole('region', {name: 'connected agent'}),
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

test('shell geometry and pinned composer follow all three widths and the exact inspector breakpoint', async () => {
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
				const inspector = page.getByRole('complementary', {
					name: 'inspector',
					includeHidden: true,
				});
				if (width > 840) await expect(inspector).toBeVisible();
				else await expect(inspector).toBeHidden();
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
						inspector: measure('.shell-inspector'),
						composer: measure('.gate-composer'),
						scrolls: scroll.scrollHeight > scroll.clientHeight,
						overflows: document.documentElement.scrollWidth > innerWidth,
					};
				});
				expect(geometry.rail.width).toBe(190);
				expect(geometry.stream.x).toBe(190);
				expect(geometry.inspector.width).toBe(width > 840 ? 240 : 0);
				expect(geometry.stream.width).toBe(
					width - 190 - (width > 840 ? 240 : 0),
				);
				expect(geometry.composer.bottom).toBe(882);
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

test('unfinished shell regions are readable static placeholders, not live controls', async () => {
	await page.setViewportSize({width: 1240, height: 900});
	await expect(page.getByRole('banner')).toContainText(
		'session tabs · not built yet',
	);
	await expect(
		page.getByRole('banner').getByRole('button', {name: 'command palette'}),
	).toBeVisible();
	await expect(
		page.getByRole('complementary', {name: 'project rail'}),
	).toContainText('thread list not built yet');
	await expect(
		page
			.locator('[data-shell-slot="project-rail"]')
			.getByRole('region', {name: 'recent projects'}),
	).toBeVisible();
	await expect(
		page.getByText('project list not built yet', {exact: true}),
	).toHaveCount(0);
	const inspector = page.getByRole('complementary', {name: 'inspector'});
	await expect(inspector).toContainText('files and review are not built yet');
	await expect(inspector.getByRole('button')).toHaveCount(0);
	await expect(inspector.getByRole('tab')).toHaveCount(0);
	for (const placeholder of await page.locator('.shell-placeholder').all()) {
		await expect(placeholder).toHaveCSS('border-style', 'dashed');
		await expect(placeholder).toHaveCSS('opacity', '1');
		await expect(
			placeholder.locator('button, input, a, [tabindex="0"]'),
		).toHaveCount(0);
	}
	await expect(page.locator('.shell-bottom-panel')).toHaveCount(0);
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
			await open.focus();
			await page.keyboard.press('Tab');
			await expect(input).toBeFocused();
			await expect(input).toHaveCSS('outline-width', '2px');
			await expect(page.locator('.gate-composer')).toHaveCSS(
				'border-color',
				theme === 'dark' ? 'rgb(69, 155, 247)' : 'rgb(0, 0, 238)',
			);
			await input.fill('fixture keyboard check');
			await page.keyboard.press('Tab');
			const send = page.getByRole('button', {name: 'send', exact: true});
			await expect(send).toBeFocused();
			await expect(send).toHaveCSS('outline-width', '2px');
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
