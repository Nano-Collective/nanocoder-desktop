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
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult} from '@/shared/ipc';
import {qaEnvironment} from './qa/environment';

const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-approvals-')),
);
const cli = path.join(work, 'nanocoder/dist/cli.js');
let app: ElectronApplication;
let page: Page;
let projectCount = 0;
const cards = () => page.getByRole('region', {name: 'permission request'});
const dialogs = () => page.getByRole('alertdialog');
const input = () => page.getByRole('textbox', {name: 'message'});
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
	page = await app.firstWindow();
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

async function open(mode = 'ok') {
	const folder = path.join(work, `project-${++projectCount}`);
	mkdirSync(folder);
	writeFileSync(path.join(folder, '.fake-nanocoder'), mode);
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
	}, folder);
	await page.getByRole('button', {name: 'open a project folder'}).click();
	await expect(
		page.getByRole('region', {name: 'connected agent'}),
	).toContainText(folder);
	await expect(input()).toBeEnabled();
}

async function prompt() {
	await input().fill('fixture approval request');
	await input().focus();
	await page.keyboard.press('Enter');
}

const cancel = () =>
	page.evaluate(() => {
		const api = (window as unknown as {desktop: DesktopApi})
			.desktop as DesktopApi & {cancelPrompt?: () => Promise<IpcResult<null>>};
		return typeof api.cancelPrompt === 'function'
			? api.cancelPrompt()
			: {
					ok: false as const,
					error: {
						code: 'UNAVAILABLE' as const,
						message: 'Cancellation is not wired',
						retryable: false,
					},
				};
	});

test('cancellation refuses no open session and is a clean no-op with no active turn', async () => {
	const unopened = await cancel();
	expect(!unopened.ok && unopened.error.code).toBe('AGENT_UNAVAILABLE');
	await open();
	expect(await cancel()).toEqual({ok: true, value: null});
	await expect(cards()).toHaveCount(0);
	await expect(input()).toBeEnabled();
});

test('cancel closes every pending permission as Interrupted, never allowed, and permits the next turn', async () => {
	await open('two-tools');
	await prompt();
	await expect(cards()).toHaveCount(2);
	await expect(
		page.getByRole('button', {name: 'cancel turn', exact: true}),
	).toBeVisible();
	await page.getByRole('button', {name: 'cancel turn', exact: true}).click();
	await expect(cards()).toHaveCount(0);
	await expect(page.getByText('turn interrupted: cancelled')).toBeVisible();
	await expect(page.locator('.ui-badge--interrupted')).toBeVisible();
	await expect(input()).toBeEnabled();
	await expect(input()).toBeFocused();
	await expect(page.locator('.gate-message-tool')).toHaveText([
		/tool .+: failed/,
		/tool .+: failed/,
	]);
	await prompt();
	await expect(cards()).toHaveCount(2);
	await page.getByRole('button', {name: 'cancel turn', exact: true}).click();
	await expect(page.getByText('turn interrupted: cancelled')).toBeVisible();
});

test('cancel also interrupts an active turn with no permission request', async () => {
	await open('wait-for-cancel');
	await prompt();
	await expect(page.locator('.ui-badge--running')).toBeVisible();
	await expect(cards()).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'cancel turn', exact: true}),
	).toBeVisible();
	await page.getByRole('button', {name: 'cancel turn', exact: true}).click();
	await expect(page.getByText('turn interrupted: cancelled')).toBeVisible();
	await expect(input()).toBeFocused();
});

test('permission takes focus, supports only its offered numbered choices and restores the composer', async () => {
	await open();
	await prompt();
	await expect(dialogs()).toBeFocused();
	await expect(dialogs()).toHaveAccessibleName(
		'approval required · protected tool · normal mode',
	);
	await expect(cards().getByRole('button').nth(0)).toHaveAccessibleName(
		'Allow',
	);
	await expect(cards().getByRole('button').nth(1)).toHaveAccessibleName('Deny');
	await expect(cards().locator('kbd')).toHaveText(['1', '2']);
	await page.keyboard.press('9');
	await expect(cards()).toBeVisible();
	await dialogs().dispatchEvent('keydown', {key: '1', repeat: true});
	await expect(cards()).toBeVisible();
	await page.getByRole('button', {name: 'open a project folder'}).focus();
	await page.keyboard.press('1');
	await expect(cards()).toBeVisible();
	await dialogs().focus();
	await page.keyboard.press('2');
	await expect(cards()).toHaveCount(0);
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
	await expect(input()).toBeFocused();
});

test('empty or modified key events never select a permission option', async () => {
	await open();
	await prompt();
	await expect(dialogs()).toBeFocused();
	for (const event of [
		{key: ''},
		{key: '12'},
		{key: '1', shiftKey: true},
		{key: '1', altKey: true},
		{key: '1', ctrlKey: true},
		{key: '1', metaKey: true},
		{key: '1', repeat: true},
	]) {
		await dialogs().dispatchEvent('keydown', event);
		await expect(cards()).toBeVisible();
	}
	await dialogs().press('2');
	await expect(cards()).toHaveCount(0);
});

test('all offered permission kinds keep their labels and their reported outcomes', async () => {
	for (const [choice, optionId, allowed] of [
		['Allow once', 'allow', true],
		['Allow always', 'allow-always', true],
		['Reject once', 'deny', false],
		['Reject all', 'deny-always', false],
	] as const) {
		await open('all-permissions');
		await prompt();
		await expect(dialogs()).toBeFocused();
		await expect(cards().getByRole('button')).toHaveCount(4);
		for (const label of [
			'Allow once',
			'Allow always',
			'Reject once',
			'Reject all',
		])
			await expect(
				cards().getByRole('button', {name: label, exact: true}),
			).toBeVisible();
		await cards().getByRole('button', {name: choice, exact: true}).click();
		await expect(cards()).toHaveCount(0);
		await expect(page.getByText('turn ended: end_turn')).toBeVisible();
		await expect(page.locator('.gate-message-tool')).toContainText(
			allowed ? 'completed' : 'failed',
		);
		await expect(page.locator('.gate-message-tool code')).toHaveText(
			`selected ${optionId}`,
		);
		await expect(input()).toBeFocused();
	}
});

test('ask_user presents only Nanocoder question options and sends the selected answer', async () => {
	await open('ask-user');
	await prompt();
	await expect(dialogs()).toBeFocused();
	await expect(cards()).toContainText('Which fixture option?');
	await expect(cards().getByRole('textbox')).toHaveCount(0);
	await expect(cards().getByRole('button').nth(0)).toHaveAccessibleName(
		'First choice',
	);
	await expect(cards().getByRole('button').nth(1)).toHaveAccessibleName(
		'Second choice',
	);
	await page.keyboard.press('2');
	await expect(cards()).toHaveCount(0);
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
	await expect(page.locator('.gate-message-tool code')).toHaveText(
		'selected answer-1',
	);
	await expect(input()).toBeFocused();
});

test('queued requests keep focus on the oldest remaining request and restore the original control', async () => {
	await open('two-tools');
	await input().fill('fixture queued requests');
	const origin = page.getByRole('button', {name: 'open a project folder'});
	await origin.focus();
	await page.evaluate(() => {
		const form = document.querySelector<HTMLFormElement>('.gate-composer');
		form?.requestSubmit();
	});
	await expect(dialogs()).toHaveCount(2);
	await expect(dialogs().first()).toBeFocused();
	await cards().last().getByRole('button', {name: 'Deny'}).click();
	await expect(dialogs()).toHaveCount(1);
	await expect(dialogs()).toBeFocused();
	await page.keyboard.press('2');
	await expect(cards()).toHaveCount(0);
	await expect(origin).toBeFocused();
});

test('focused approvals stay fully visible across turns and widths in both themes', async () => {
	await page.emulateMedia({reducedMotion: 'no-preference'});
	await open('all-permissions');
	for (const theme of ['dark', 'light']) {
		for (const width of [1240, 1020, 840]) {
			await page.setViewportSize({width, height: 900});
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			await prompt();
			await expect(dialogs()).toBeFocused();
			await expect
				.poll(() =>
					page.evaluate(() =>
						document
							.getAnimations()
							.filter(animation => animation instanceof CSSTransition)
							.every(animation => animation.playState === 'finished'),
					),
				)
				.toBe(true);
			await expect(cards()).toHaveCSS('animation-name', 'approval-pulse');
			await expect(cards()).toHaveCSS('animation-duration', '2.2s');
			await expect(cards()).toHaveCSS(
				'border-top-color',
				theme === 'dark' ? 'rgb(221, 167, 60)' : 'rgb(154, 103, 0)',
			);
			await expect(dialogs()).toHaveCSS('outline-width', '2px');
			for (const hint of await cards().locator('kbd').all())
				await expect(hint).toHaveCSS('opacity', '1');
			const geometry = await cards().evaluate(card => {
				const rect = card.getBoundingClientRect();
				const scroll = document
					.querySelector('.shell-stream-scroll')
					?.getBoundingClientRect();
				return {
					left: rect.left,
					right: rect.right,
					top: rect.top,
					bottom: rect.bottom,
					scrollTop: scroll?.top ?? 0,
					scrollBottom: scroll?.bottom ?? 0,
					overflow: document.documentElement.scrollWidth > innerWidth,
				};
			});
			expect(geometry.overflow).toBe(false);
			expect(geometry.left).toBeGreaterThanOrEqual(0);
			expect(geometry.right).toBeLessThanOrEqual(width);
			expect(geometry.top).toBeGreaterThanOrEqual(geometry.scrollTop);
			expect(geometry.bottom).toBeLessThanOrEqual(geometry.scrollBottom);
			await page.keyboard.press('4');
			await expect(cards()).toHaveCount(0);
			await expect(input()).toBeFocused();
			await expect(input()).toHaveCSS('outline-width', '2px');
			await expect(page.locator('.ui-badge--approval')).toHaveCount(0);
		}
	}
	await page.emulateMedia({reducedMotion: 'reduce'});
	await open();
	await prompt();
	await expect(dialogs()).toBeFocused();
	await expect(cards()).toHaveCSS('animation-name', 'none');
	await expect(dialogs()).toHaveCSS('transition-duration', '0s');
	await page.keyboard.press('2');
	await expect(input()).toBeFocused();
});

test.describe('approval and overlay focus', () => {
	test.afterEach(async () => {
		if (await page.locator('dialog[open]').count())
			await page.keyboard.press('Escape');
		if (await page.locator('.approval-dialog').count()) await cancel();
	});

	test('explicit overlays return to the exact approval control and Escape never answers', async () => {
		await open('all-permissions');
		await prompt();
		await expect(dialogs()).toBeFocused();
		const origin = cards().getByRole('button', {name: 'Allow always'});
		await origin.focus();
		for (const key of [paletteKey, '?']) {
			await page.keyboard.press(key);
			const overlay = page.locator('dialog[open]');
			await expect(overlay).toBeVisible();
			await expect
				.poll(() =>
					overlay.evaluate(dialog => dialog.contains(document.activeElement)),
				)
				.toBe(true);
			if (key === paletteKey) {
				await overlay.getByRole('combobox').fill('2');
				await expect(page.locator('.approval-dialog')).toHaveCount(1);
			}
			await page.keyboard.press('Escape');
			await expect(overlay).toHaveCount(0);
			await expect(origin).toBeFocused();
			await expect(cards()).toHaveCount(1);
		}
		await page.keyboard.press('Escape');
		await expect(origin).toBeFocused();
		await expect(cards()).toHaveCount(1);
		await expect(input()).toBeDisabled();
		await page.keyboard.press('3');
		await expect(cards()).toHaveCount(0);
		await expect(input()).toBeFocused();
	});

	for (const kind of ['palette', 'shortcuts'] as const) {
		const name = kind === 'palette' ? 'command palette' : 'keyboard shortcuts';
		const focusedControl = () =>
			kind === 'palette'
				? page.getByRole('combobox')
				: page.getByRole('button', {name: 'close keyboard shortcuts'});

		test(`an approval arriving during ${kind} is announced without stealing focus and takes focus after Escape`, async () => {
			await open();
			await input().fill('fixture approval request');
			await input().focus();
			await page.evaluate(kind => {
				document
					.querySelector<HTMLFormElement>('.gate-composer')
					?.requestSubmit();
				const mac = navigator.platform.startsWith('Mac');
				document.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: kind === 'palette' ? 'k' : '?',
						metaKey: kind === 'palette' && mac,
						ctrlKey: kind === 'palette' && !mac,
						bubbles: true,
					}),
				);
			}, kind);
			await expect(page.getByRole('dialog', {name, exact: true})).toBeVisible();
			await expect(page.locator('.approval-dialog')).toHaveCount(1);
			await expect(focusedControl()).toBeFocused();
			const notification = page.locator('.toast-region');
			await expect(notification).toHaveAttribute('aria-live', 'polite');
			await expect(notification).toContainText('approval required · 1 waiting');
			expect(
				await notification.evaluate(region =>
					region.closest('dialog:modal')?.getAttribute('aria-label'),
				),
			).toBe(name);
			await page.keyboard.press('Escape');
			await expect(page.locator('dialog[open]')).toHaveCount(0);
			await expect(dialogs()).toBeFocused();
			await expect(cards().getByRole('button')).toHaveCount(2);
			await page.keyboard.press('2');
			await expect(cards()).toHaveCount(0);
			await expect(input()).toBeFocused();
		});

		test(`cancelling approval during ${kind} defers composer focus until Escape`, async () => {
			await open();
			await prompt();
			await expect(dialogs()).toBeFocused();
			await page.keyboard.press(kind === 'palette' ? paletteKey : '?');
			await expect(focusedControl()).toBeFocused();
			expect(await cancel()).toEqual({ok: true, value: null});
			await expect(page.locator('.approval-dialog')).toHaveCount(0);
			await expect(input()).toBeEnabled();
			await expect(focusedControl()).toBeFocused();
			await page.keyboard.press('Escape');
			await expect(page.locator('dialog[open]')).toHaveCount(0);
			await expect(input()).toBeFocused();
			await expect(page.getByText('turn interrupted: cancelled')).toBeVisible();
		});
	}
});
