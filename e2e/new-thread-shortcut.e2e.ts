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
import {expect, test} from '@playwright/test';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

const newThreadKey = process.platform === 'darwin' ? 'Meta+n' : 'Control+n';

test('the new thread shortcut refuses without a project and opens the draft dialog with one', async () => {
	const root = path.resolve(import.meta.dirname, '..');
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-new-thread-shortcut-')),
	);
	const project = path.join(work, 'project');
	const cli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(project);
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
	const app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	try {
		const page = await app.firstWindow();
		await expect(
			page.getByRole('button', {name: 'open a project folder', exact: true}),
		).toBeVisible();
		await page.keyboard.press(newThreadKey);
		await expect(page.locator('.overlay-toast')).toContainText(
			'select a project first',
		);
		const dialog = page.getByRole('dialog', {name: 'new thread', exact: true});
		await expect(dialog).toHaveCount(0);

		await app.evaluate(({dialog}, folder) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [folder],
			})) as typeof dialog.showOpenDialog;
		}, project);
		await page
			.getByRole('button', {name: 'open a project folder', exact: true})
			.click();
		await expect(
			page.getByRole('textbox', {name: 'message', exact: true}),
		).toBeEnabled();

		await page.keyboard.press(newThreadKey);
		await expect(dialog).toBeVisible();
		await dialog
			.getByRole('button', {name: 'keep as new thread draft', exact: true})
			.click();
		await expect(dialog).toBeHidden();
		await expect(
			page.locator('.thread-row[data-selected="true"] .thread-title'),
		).toHaveText('new thread');

		const selected = page.locator('.thread-row[data-selected="true"]');
		const first = await selected.getAttribute('data-thread-id');
		const draft = 'draft for the second new thread';
		await page.keyboard.press(newThreadKey);
		await expect(dialog).toBeVisible();
		await dialog.getByRole('textbox').fill(draft);
		await dialog
			.getByRole('button', {name: 'keep as new thread draft', exact: true})
			.click();
		await expect(dialog).toBeHidden();
		await expect
			.poll(() => selected.getAttribute('data-thread-id'))
			.not.toBe(first);
		const second = await selected.getAttribute('data-thread-id');
		const message = page.getByRole('textbox', {name: 'message', exact: true});
		await expect(message).toHaveValue(draft);
		await page
			.locator(`.thread-row[data-thread-id="${first}"] .thread-open`)
			.click();
		await expect(message).toHaveValue('');
		await page
			.locator(`.thread-row[data-thread-id="${second}"] .thread-open`)
			.click();
		await expect(message).toHaveValue(draft);
	} finally {
		await test.step('close the hidden app', () => app.close(), {
			timeout: 5_000,
		});
		rmSync(work, {recursive: true, force: true});
	}
});
