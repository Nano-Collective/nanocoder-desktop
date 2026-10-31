import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect, test} from '@playwright/test';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

test('quiet launch and macOS activation keep native windows and Dock hidden without faking DOM focus', async () => {
	test.skip(
		process.env.NANOCODER_E2E_VISIBLE === '1',
		'Manual visible QA opt-in',
	);
	const profile = mkdtempSync(path.join(tmpdir(), 'nd-quiet-e2e-'));
	const cli = path.join(profile, 'nanocoder/dist/cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', cli);
	writeFileSync(
		path.join(profile, 'nanocoder/package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	const app = await electron.launch({
		args: ['.', `--user-data-dir=${profile}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	try {
		const page = await app.firstWindow();
		await expect(page.getByRole('heading', {level: 1})).toHaveText(
			'Nanocoder Desktop',
		);
		expect(
			await app.evaluate(({app: main, BrowserWindow}) => {
				const window = BrowserWindow.getAllWindows()[0];
				const events: string[] = [];
				window.on('show', () => events.push('show'));
				window.on('focus', () => events.push('focus'));
				main.emit('activate');
				main.emit('second-instance');
				return {
					visible: window.isVisible(),
					focused: window.isFocused(),
					dock: main.dock?.isVisible() ?? false,
					events,
				};
			}),
		).toEqual({visible: false, focused: false, dock: false, events: []});
		const open = page.getByRole('button', {name: 'open a project folder'});
		await open.focus();
		await page.keyboard.press('Tab');
		expect(
			await open.evaluate(element => element === document.activeElement),
		).toBe(false);
		const paletteKey = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
		await page.keyboard.press(paletteKey);
		const search = page.getByRole('combobox');
		await expect(search).toBeFocused();
		await search.pressSequentially('switch');
		await expect(search).toHaveValue('switch');
		expect(
			await search.evaluate(element => element.matches(':focus-visible')),
		).toBe(true);
		await search.press('Escape');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await test.step('hidden renderers retain foreground frame cadence', async () => {
			await page.evaluate(() => document.fonts.ready.then(() => undefined));
			const native = await app.evaluate(({BrowserWindow}) => {
				const window = BrowserWindow.getAllWindows()[0];
				return {
					visible: window.isVisible(),
					focused: window.isFocused(),
					backgroundThrottling: window.webContents.getBackgroundThrottling(),
				};
			});
			const frames = await page.evaluate(
				() =>
					new Promise<{gaps: number[]; visibility: string}>(resolve => {
						const times: number[] = [];
						const frame = (at: number) => {
							times.push(at);
							if (times.length === 6) {
								resolve({
									gaps: times
										.slice(1)
										.map((time, index) => time - times[index]),
									visibility: document.visibilityState,
								});
								return;
							}
							requestAnimationFrame(frame);
						};
						requestAnimationFrame(frame);
					}),
			);
			console.info('hidden-window frames', JSON.stringify({native, ...frames}));
			expect(native.visible).toBe(false);
			expect(native.focused).toBe(false);
			expect(Math.max(...frames.gaps)).toBeLessThanOrEqual(100);
			expect(native.backgroundThrottling).toBe(true);
		});
	} finally {
		await app.close();
		rmSync(profile, {recursive: true, force: true});
	}
});
