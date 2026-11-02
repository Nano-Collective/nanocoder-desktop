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
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import {openFolderFromPalette} from './qa/open-folder';

let work: string;
let root: string;
let app: ElectronApplication;
let page: Page;
const paletteKey = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

test.beforeEach(async () => {
	work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-diagnostics-focus-')),
	);
	root = path.join(work, 'project');
	const cli = path.join(work, 'nanocoder', 'dist', 'cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	mkdirSync(root);
	writeFileSync(
		path.join(work, 'nanocoder', 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', cli);
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	page = await app.firstWindow();
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
	}, root);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'ok');
	await openFolderFromPalette(page, root);
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
});

test.afterEach(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

async function openDiagnostics(): Promise<void> {
	await page
		.getByRole('button', {name: 'runtime details', exact: true})
		.click();
	await page
		.getByRole('dialog', {name: 'runtime details'})
		.getByRole('button', {name: 'review diagnostics', exact: true})
		.click();
	await expect(
		page.getByRole('dialog', {name: 'review captured diagnostics'}),
	).toBeVisible();
	await expect(
		page.getByRole('region', {name: 'captured diagnostics'}),
	).toBeVisible();
}

// Confirms the export, then holds the save dialog until the test releases it.
async function holdExportSave(): Promise<void> {
	await app.evaluate(({dialog}) => {
		const state = globalThis as {
			saveRequested?: boolean;
			releaseSave?: () => void;
		};
		dialog.showMessageBox = (async () => ({
			response: 0,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
		dialog.showSaveDialog = (() =>
			new Promise(resolve => {
				state.saveRequested = true;
				state.releaseSave = () => resolve({canceled: true, filePath: ''});
			})) as typeof dialog.showSaveDialog;
	});
}

test('Escape closes an idle diagnostics review and removes its captured lines', async () => {
	await openDiagnostics();
	await page.keyboard.press('Escape');
	await expect(
		page.getByRole('dialog', {name: 'review captured diagnostics'}),
	).toBeHidden();
	await expect(
		page.getByRole('region', {name: 'captured diagnostics'}),
	).toHaveCount(0);
});

test('the palette replaces an idle diagnostics review and Escape clears it', async () => {
	await openDiagnostics();
	await page.keyboard.press(paletteKey);
	const palette = page.getByRole('dialog', {
		name: 'command palette',
		exact: true,
	});
	await expect(palette).toBeVisible();
	await expect(
		page.getByRole('dialog', {name: 'review captured diagnostics'}),
	).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(palette).toBeHidden();
	await expect(
		page.getByRole('region', {name: 'captured diagnostics'}),
	).toHaveCount(0);
});

test('a busy diagnostics export refuses Escape and the palette until its save settles, then close clears the review', async () => {
	await holdExportSave();
	await openDiagnostics();
	const review = page.getByRole('dialog', {
		name: 'review captured diagnostics',
	});
	const exportButton = review.getByRole('button', {
		name: 'choose export destination…',
		exact: true,
	});
	await exportButton.click();
	await expect(exportButton).toBeDisabled();
	await expect
		.poll(() =>
			app.evaluate(
				() => (globalThis as {saveRequested?: boolean}).saveRequested === true,
			),
		)
		.toBe(true);

	// Both keys are handled before the save settles, so the checks after release are final.
	await page.keyboard.press('Escape');
	await page.keyboard.press(paletteKey);
	await expect(review).toBeVisible();
	await expect(
		page.getByRole('dialog', {name: 'command palette', exact: true}),
	).toHaveCount(0);

	await app.evaluate(() =>
		(globalThis as {releaseSave?: () => void}).releaseSave?.(),
	);
	await expect(review).toContainText('export cancelled');
	await expect(exportButton).toBeEnabled();

	await page.keyboard.press('Escape');
	await expect(review).toBeHidden();
	await expect(
		page.getByRole('region', {name: 'captured diagnostics'}),
	).toHaveCount(0);
	await expect(page.getByText('export cancelled')).toHaveCount(0);
});
