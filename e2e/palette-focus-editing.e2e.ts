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
import {qaEnvironment} from './qa/environment';

const root = path.resolve(import.meta.dirname, '..');
const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-palette-editing-')),
);
const cli = path.join(work, 'nanocoder/dist/cli.js');
const paletteKey = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
let app: ElectronApplication;
let page: Page;
const input = () => page.getByRole('textbox', {name: 'message', exact: true});

test.beforeAll(async () => {
	mkdirSync(path.dirname(cli), {recursive: true});
	copyFileSync(
		path.join(root, 'source/main/nanocoder/fixtures/fake-nanocoder.mjs'),
		cli,
	);
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
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	page = await app.firstWindow();
	expect(page.url()).toMatch(/^app:\/\/renderer\//);
	const project = path.join(work, 'project');
	mkdirSync(project);
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
	}, project);
	await page.getByRole('button', {name: 'open a project folder'}).click();
	await expect(input()).toBeEnabled();
	await input().evaluate(element => {
		element.dataset.inputEvents = '0';
		element.addEventListener('input', () => {
			element.dataset.inputEvents = String(
				Number(element.dataset.inputEvents) + 1,
			);
		});
	});
});

test.afterAll(async () => {
	try {
		await app?.close();
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
});

for (const method of [
	'palette Escape',
	'palette command',
	'shortcuts Escape',
	'shortcuts close button',
] as const) {
	test(`${method} restores actual composer editing, not just DOM focus (A11Y-01/02)`, async () => {
		await input().focus();
		await input().press('ControlOrMeta+a');
		await input().press('Backspace');
		await input().pressSequentially('before');
		await expect(input()).toHaveValue('before');
		await input().press('ControlOrMeta+a');
		await input().press('Backspace');
		await page.keyboard.press(paletteKey);
		const palette = page.getByRole('dialog', {
			name: 'command palette',
			exact: true,
		});
		const search = palette.getByRole('combobox');
		await expect(search).toBeFocused();
		if (method.startsWith('shortcuts')) {
			await search.pressSequentially('keyboard shortcuts');
			await search.press('Enter');
			const close = page.getByRole('button', {
				name: 'close keyboard shortcuts',
			});
			await expect(close).toBeFocused();
			await close.press(method.endsWith('Escape') ? 'Escape' : 'Enter');
		} else if (method.endsWith('command')) {
			await search.pressSequentially('switch to light theme');
			await search.press('Enter');
		} else {
			await search.press('Escape');
		}
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect(input()).toBeFocused();
		const eventsBefore = Number(
			await input().getAttribute('data-input-events'),
		);
		await input().pressSequentially('after overlay');
		await expect(input()).toHaveValue('after overlay');
		expect(
			Number(await input().getAttribute('data-input-events')),
		).toBeGreaterThan(eventsBefore);
		await expect(
			page.getByRole('button', {name: 'send', exact: true}),
		).toBeEnabled();
	});
}
