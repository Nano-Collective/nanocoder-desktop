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

const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-e2e-rt-')),
);
const fakeCli = path.join(work, 'nanocoder', 'dist', 'cli.js');

test.afterAll(() => {
	rmSync(work, {recursive: true, force: true});
});

test('finds Nanocoder installed after the app started, without a restart', async () => {
	const app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: {
			...process.env,
			NANOCODER_DESKTOP_CLI: fakeCli,
			NANOCODER_DESKTOP_NODE: process.execPath,
		},
	});
	try {
		const page = await app.firstWindow();
		const alert = page.getByRole('alert');
		await expect(alert).toContainText('Nanocoder is not installed');
		await expect(
			page.getByRole('button', {name: 'Open a project folder'}),
		).toHaveCount(0);

		// Install it while the app is running.
		mkdirSync(path.dirname(fakeCli), {recursive: true});
		writeFileSync(
			path.join(work, 'nanocoder', 'package.json'),
			JSON.stringify({
				name: '@nanocollective/nanocoder',
				version: '9.9.9',
				type: 'module',
				bin: {nanocoder: 'dist/cli.js'},
			}),
		);
		copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', fakeCli);

		await page.getByRole('button', {name: 'Check again'}).click();
		await expect(alert).toHaveCount(0);
		const setup = page.getByRole('dialog', {name: 'runtime details'});
		if (!(await setup.isVisible())) {
			await page
				.getByRole('button', {name: 'runtime details', exact: true})
				.focus();
			await page.keyboard.press('Enter');
		}
		await expect(setup).toBeVisible();
		await expect(setup.locator('.runtime-rows')).toContainText('9.9.9');
		await expect(setup.locator('.runtime-rows')).toContainText(fakeCli);
		await page.keyboard.press('Escape');
		await expect(setup).toBeHidden();
		await expect(alert).toHaveCount(0);
		await expect(
			page.getByRole('button', {name: 'Open a project folder'}),
		).toBeVisible();
	} finally {
		await app.close();
	}
});
