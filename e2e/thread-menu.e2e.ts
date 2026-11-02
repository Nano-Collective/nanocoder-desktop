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

test('the header thread actions button gets its focus back after a dialog replaces it', async () => {
	const root = path.resolve(import.meta.dirname, '..');
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-thread-menu-')),
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
		const newThread = page.getByRole('dialog', {
			name: 'new thread',
			exact: true,
		});
		await expect(newThread).toBeVisible();
		await newThread
			.getByRole('button', {name: 'keep as new thread draft', exact: true})
			.click();
		await expect(newThread).toBeHidden();

		const menu = page.getByRole('button', {
			name: 'thread actions',
			exact: true,
		});
		await menu.click();
		const actions = page.getByRole('dialog', {
			name: 'thread actions',
			exact: true,
		});
		await expect(actions).toBeVisible();
		await actions.getByRole('button', {name: 'rename…', exact: true}).click();
		const rename = page.getByRole('dialog', {
			name: 'rename thread',
			exact: true,
		});
		await expect(rename).toBeVisible();
		await expect(actions).toBeHidden();
		await page.keyboard.press('Escape');
		await expect(rename).toBeHidden();
		await expect(menu).toBeFocused();
	} finally {
		await test.step('close the hidden app', () => app.close(), {
			timeout: 5_000,
		});
		rmSync(work, {recursive: true, force: true});
	}
});
