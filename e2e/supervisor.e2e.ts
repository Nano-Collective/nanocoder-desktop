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
import {_electron as electron, expect, test} from '@playwright/test';
import {qaEnvironment} from './qa/environment';

test('quit during initialize waits for the starting child to exit', async () => {
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-quit-')),
	);
	const root = path.join(work, 'project');
	const cli = path.join(work, 'nanocoder', 'dist', 'cli.js');
	mkdirSync(root);
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(path.join(root, '.fake-nanocoder'), 'silent');
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
	const app = await electron.launch({
		args: ['.'],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	try {
		await app.evaluate(({dialog}, root) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [root],
			})) as typeof dialog.showOpenDialog;
		}, root);
		const page = await app.firstWindow();
		await page.getByRole('button', {name: 'Open a project folder'}).click();
		let pid: number | undefined;
		await expect
			.poll(async () => {
				pid = await app.evaluate((_electron, cli) => {
					const handles = (
						process as unknown as {
							_getActiveHandles(): Array<{pid?: number; spawnargs?: string[]}>;
						}
					)._getActiveHandles();
					return handles.find(handle => handle.spawnargs?.includes(cli))?.pid;
				}, cli);
				return pid;
			})
			.toBeTruthy();
		await expect(
			page.getByRole('button', {name: 'Starting Nanocoder'}),
		).toBeDisabled();
		await app.close();
		expect(() => process.kill(pid ?? 0, 0)).toThrow();
	} finally {
		await app.close().catch(() => {});
		rmSync(work, {recursive: true, force: true});
	}
});
