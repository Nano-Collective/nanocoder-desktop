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
import {expect, type Page, test} from '@playwright/test';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-cross-dialog-')),
);
const cli = path.join(work, 'nanocoder/dist/cli.js');
let app: Awaited<ReturnType<typeof electron.launch>>;
const paletteKey = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

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
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

function runtimeButton(page: Page) {
	return page.getByRole('button', {name: 'runtime details', exact: true});
}

function runtimeDialog(page: Page) {
	return page.getByRole('dialog', {name: 'runtime details', exact: true});
}

test('Escape closes a header runtime dialog and focus returns to its button', async () => {
	const page = await app.firstWindow();
	const opener = runtimeButton(page);
	await opener.focus();
	await page.keyboard.press('Enter');
	await expect(runtimeDialog(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(runtimeDialog(page)).toBeHidden();
	await expect(opener).toBeFocused();
});

test('the palette replaces a header runtime dialog and Escape returns focus to the runtime button', async () => {
	const page = await app.firstWindow();
	const opener = runtimeButton(page);
	await opener.focus();
	await page.keyboard.press('Enter');
	await expect(runtimeDialog(page)).toBeVisible();
	await page.keyboard.press(paletteKey);
	const palette = page.getByRole('dialog', {
		name: 'command palette',
		exact: true,
	});
	await expect(palette).toBeVisible();
	await expect(runtimeDialog(page)).toHaveCount(0);
	await expect(palette.getByRole('combobox')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(palette).toBeHidden();
	await expect(opener).toBeFocused();
});

test('capabilities opened from runtime details returns focus to the runtime button on Escape', async () => {
	const page = await app.firstWindow();
	const opener = runtimeButton(page);
	await opener.focus();
	await page.keyboard.press('Enter');
	const runtime = runtimeDialog(page);
	await expect(runtime).toBeVisible();
	await runtime
		.getByRole('button', {name: 'capabilities', exact: true})
		.click();
	const capabilities = page.getByRole('dialog', {
		name: 'capabilities, with reasons',
		exact: true,
	});
	await expect(capabilities).toBeVisible();
	await expect(runtime).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(capabilities).toBeHidden();
	await expect(opener).toBeFocused();
});

test('the palette opened from its trigger returns focus there after it is replaced by the shortcut sheet', async () => {
	const page = await app.firstWindow();
	const trigger = page.getByRole('button', {name: 'command palette'});
	await trigger.focus();
	await page.keyboard.press(paletteKey);
	const palette = page.getByRole('dialog', {
		name: 'command palette',
		exact: true,
	});
	const input = palette.getByRole('combobox');
	await expect(input).toBeFocused();
	await input.fill('keyboard shortcuts');
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', {
		name: 'keyboard shortcuts',
		exact: true,
	});
	await expect(sheet).toBeVisible();
	await expect(palette).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(trigger).toBeFocused();
});
