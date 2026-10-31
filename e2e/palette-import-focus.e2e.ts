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

test('palette import saved sessions focuses the first offered row, then refresh when none remain', async () => {
	const root = path.resolve(import.meta.dirname, '..');
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-palette-import-focus-')),
	);
	const project = path.join(work, 'project-a');
	const cli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(project);
	writeFileSync(path.join(project, '.fake-nanocoder'), 'session-discovery');
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
		env: qaEnvironment(process.env, {
			cliPath: cli,
			nodePath: process.execPath,
		}),
	});
	try {
		const page = await app.firstWindow();
		await page.emulateMedia({reducedMotion: 'reduce'});
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

		const imports = page.getByRole('region', {
			name: 'import saved sessions',
			exact: true,
		});
		const importButton = imports.getByRole('button', {
			name: 'import saved session: <script>saved fixture</script>',
			exact: true,
		});
		const refresh = imports.getByRole('button', {
			name: 'refresh saved sessions',
			exact: true,
		});
		await expect(importButton).toBeEnabled();

		const palette = page.getByRole('dialog', {
			name: 'command palette',
			exact: true,
		});
		const runImportCommand = async () => {
			await page
				.getByRole('button', {name: 'command palette', exact: true})
				.click();
			await palette.getByRole('combobox').fill('import saved sessions');
			const option = palette.getByRole('option', {
				name: /import saved sessions/,
			});
			await expect(option).toHaveAttribute('aria-selected', 'true');
			await expect(option).not.toHaveAttribute('aria-disabled', 'true');
			await page.keyboard.press('Enter');
			await expect(palette).toBeHidden();
		};

		await runImportCommand();
		await expect(importButton).toBeFocused();
		await expect(importButton).toBeVisible();

		await page.keyboard.press('Enter');
		await expect(importButton).toHaveCount(0);
		await expect(refresh).toBeFocused();
		await expect(refresh).toBeEnabled();

		await runImportCommand();
		await expect(refresh).toBeFocused();
		await expect(imports).toContainText('no sessions offered for import');
	} finally {
		await test.step('close the hidden app', () => app.close(), {
			timeout: 5_000,
		});
		rmSync(work, {recursive: true, force: true});
	}
});
