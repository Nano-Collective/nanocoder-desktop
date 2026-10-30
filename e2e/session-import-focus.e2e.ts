import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	type ElectronApplication,
	expect,
	type Page,
	test,
} from '@playwright/test';
import {build} from 'vite';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import type {importFocusHarness} from './qa/session-import-focus-harness';

interface HarnessWindow extends Window {
	sessionImportFocusFixture: {importFocusHarness: typeof importFocusHarness};
}

const root = path.resolve(import.meta.dirname, '..');
const work = mkdtempSync(path.join(tmpdir(), 'nd-import-focus-'));
let app: ElectronApplication;
let page: Page;
const imports = () =>
	page.getByRole('region', {name: 'import saved sessions', exact: true});
const refresh = () =>
	imports().getByRole('button', {name: 'refresh saved sessions', exact: true});
const add = () =>
	imports().getByRole('button', {
		name: 'import saved session: saved project-a',
		exact: true,
	});
const input = () => page.getByRole('textbox', {name: 'message', exact: true});

test.beforeAll(async () => {
	const result = await build({
		configFile: false,
		logLevel: 'silent',
		define: {'process.env.NODE_ENV': JSON.stringify('production')},
		resolve: {alias: {'@': path.join(root, 'source')}},
		build: {
			write: false,
			minify: false,
			lib: {
				entry: path.join(root, 'e2e/qa/session-import-focus-harness.ts'),
				name: 'sessionImportFocusFixture',
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
	if (!code) throw new Error('Missing session import focus fixture');
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {
			cliPath: path.join(
				root,
				'source/main/nanocoder/fixtures/fake-nanocoder.mjs',
			),
			nodePath: process.execPath,
		}),
	});
	page = await app.firstWindow();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.emulateMedia({reducedMotion: 'reduce'});
	await page.evaluate(code);
});

test.afterEach(async () => {
	await page.evaluate(() =>
		(
			window as unknown as HarnessWindow
		).sessionImportFocusFixture.importFocusHarness.dispose(),
	);
	expect(
		await app.evaluate(({BrowserWindow}) =>
			BrowserWindow.getAllWindows().every(window => !window.isVisible()),
		),
	).toBe(true);
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

async function mount(theme: 'dark' | 'light') {
	await page.evaluate(
		theme =>
			(
				window as unknown as HarnessWindow
			).sessionImportFocusFixture.importFocusHarness.mount(theme),
		theme,
	);
	await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

for (const theme of ['dark', 'light'] as const) {
	test(`ACP-18 ${theme} pending import does not steal focus from an edited composer`, async () => {
		await mount(theme);
		await add().click();
		await expect(add()).toBeDisabled();
		await expect(imports().getByRole('status')).toHaveText(
			'waiting for the metadata import',
		);
		await input().focus();
		await page.keyboard.type('fixture draft while importing');
		await expect(input()).toBeFocused();
		await expect(input()).toHaveValue('fixture draft while importing');
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).sessionImportFocusFixture.importFocusHarness.release(),
		);
		await expect(add()).toHaveCount(0);
		await expect(refresh()).toBeEnabled();
		await expect(input()).toBeFocused();
		await page.keyboard.type(' continues here');
		await expect(input()).toHaveValue(
			'fixture draft while importing continues here',
		);
	});

	test(`ACP-18 ${theme} pending plain-props import cannot return focus into a different project`, async () => {
		await mount(theme);
		await add().focus();
		await page.keyboard.press('Enter');
		await expect(add()).toBeDisabled();
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).sessionImportFocusFixture.importFocusHarness.switchProject(),
		);
		const newImport = imports().getByRole('button', {
			name: 'import saved session: saved project-b',
			exact: true,
		});
		await expect(newImport).toBeDisabled();
		expect(
			await page.evaluate(() => document.activeElement === document.body),
		).toBe(true);
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).sessionImportFocusFixture.importFocusHarness.release(),
		);
		await expect(newImport).toBeEnabled();
		expect(
			await page.evaluate(() => document.activeElement === document.body),
		).toBe(true);
		await expect(refresh()).not.toBeFocused();
	});

	test(`ACP-18 ${theme} keyboard-only import still returns focus inside its originating region`, async () => {
		await mount(theme);
		await refresh().focus();
		await page.keyboard.press('Tab');
		await expect(add()).toBeFocused();
		await expect(add()).toHaveCSS('outline-width', '2px');
		await page.keyboard.press('Enter');
		await expect(add()).toBeDisabled();
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).sessionImportFocusFixture.importFocusHarness.release(),
		);
		await expect(add()).toHaveCount(0);
		await expect(refresh()).toBeFocused();
		await expect(refresh()).toHaveCSS('outline-width', '2px');
	});
}
