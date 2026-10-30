import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect, test} from '@playwright/test';
import {electron} from './qa/electron';

test('quiet launch and macOS activation keep native windows and Dock hidden without faking DOM focus', async () => {
	test.skip(
		process.env.NANOCODER_E2E_VISIBLE === '1',
		'Manual visible QA opt-in',
	);
	const profile = mkdtempSync(path.join(tmpdir(), 'nd-quiet-e2e-'));
	const app = await electron.launch({
		args: ['.', `--user-data-dir=${profile}`],
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
	} finally {
		await app.close();
		rmSync(profile, {recursive: true, force: true});
	}
});
