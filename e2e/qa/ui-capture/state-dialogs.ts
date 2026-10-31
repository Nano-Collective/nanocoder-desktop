import {expect, type Page} from '@playwright/test';
import type {Capture, CaptureState} from './harness';

const PALETTE_KEY = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
const SLOW = {timeout: 30_000};

const MAIN = 'export the audit log';

async function openProject(capture: Capture, mode: string): Promise<Page> {
	await capture.nativeAnswer(0);
	await capture.openProject(capture.project('tide', mode));
	const {page} = capture;
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled(SLOW);
	return page;
}

function row(page: Page, title: string) {
	return page
		.locator('.thread-row')
		.filter({has: page.locator('.thread-title', {hasText: title})});
}

async function send(page: Page, text: string): Promise<void> {
	const input = page.getByRole('textbox', {name: 'message', exact: true});
	await expect(input).toBeEnabled(SLOW);
	await input.fill(text);
	await page.getByRole('button', {name: 'send', exact: true}).click();
}

// `extensions` asks one execute_bash permission per turn; allowing it ends the turn as ready.
async function finishedTurn(page: Page, text: string): Promise<void> {
	await send(page, text);
	const approval = page.getByRole('region', {name: 'permission request'});
	await approval.getByRole('button', {name: 'Allow', exact: true}).click();
	await expect(page.getByText('turn ended: end_turn')).toBeVisible(SLOW);
	await expect(row(page, text)).toBeVisible();
}

async function runningTurn(page: Page, text: string): Promise<void> {
	await send(page, text);
	await expect(page.locator('.ui-badge--running')).toBeVisible(SLOW);
	await expect(page.getByText('Working on it.')).toBeVisible(SLOW);
}

async function newThread(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'new thread', exact: true}).click();
	await expect(
		page.locator('.thread-row[data-selected="true"] .thread-title'),
	).toHaveText('new thread');
}

async function readyThread(capture: Capture): Promise<Page> {
	const page = await openProject(capture, 'extensions');
	await finishedTurn(page, MAIN);
	return page;
}

async function runningThread(capture: Capture): Promise<Page> {
	const page = await openProject(capture, 'wait-for-cancel');
	await runningTurn(page, MAIN);
	return page;
}

async function openPalette(page: Page) {
	await page.keyboard.press(PALETTE_KEY);
	const palette = page.getByRole('dialog', {
		name: 'command palette',
		exact: true,
	});
	await expect(palette.getByRole('combobox')).toBeFocused();
	return palette;
}

async function shortcutsFromPalette(page: Page): Promise<void> {
	const palette = await openPalette(page);
	await palette.getByRole('combobox').fill('keyboard shortcuts');
	await page.keyboard.press('Enter');
	await expect(
		page.getByRole('dialog', {name: 'keyboard shortcuts', exact: true}),
	).toBeVisible();
}

async function threadMenu(page: Page, title: string) {
	const target = row(page, title);
	await target.locator('summary').click();
	const list = target.locator('.thread-action-list');
	await expect(list).toBeVisible();
	return target;
}

const NATIVE =
	'native Electron message box shown by the main process (dialog.showMessageBox); the page screenshot cannot include OS dialogs and the capture harness answers them with a stub';

export const states: CaptureState[] = [
	{
		stem: 'palette-main',
		manifestId: 'palette-main',
		fixture: 'wait-for-cancel, no edits',
		how: `open project tide, send "${MAIN}" (turn keeps running), press ${PALETTE_KEY}`,
		async reach(capture) {
			const page = await runningThread(capture);
			await openPalette(page);
		},
	},
	{
		stem: 'shortcuts-main',
		manifestId: 'shortcuts-main',
		fixture: 'wait-for-cancel, no edits',
		how: `open project tide, send "${MAIN}" (turn keeps running), ${PALETTE_KEY}, type "keyboard shortcuts", Enter`,
		async reach(capture) {
			const page = await runningThread(capture);
			await shortcutsFromPalette(page);
		},
	},
	{
		stem: 'palette',
		manifestId: 'palette',
		fixture: 'extensions, no edits',
		how: `open project tide, send "${MAIN}", allow the permission, press ${PALETTE_KEY}`,
		async reach(capture) {
			const page = await readyThread(capture);
			await openPalette(page);
		},
	},
	{
		stem: 'palette-empty',
		manifestId: 'palette-empty',
		fixture: 'extensions, no edits',
		how: `ready thread "${MAIN}", press ${PALETTE_KEY}, type "zzz"`,
		async reach(capture) {
			const page = await readyThread(capture);
			const palette = await openPalette(page);
			await palette.getByRole('combobox').fill('zzz');
			await expect(palette.getByText('no matching commands')).toBeVisible();
		},
	},
	{
		stem: 'shortcuts',
		manifestId: 'shortcuts',
		fixture: 'extensions, no edits',
		how: `ready thread "${MAIN}", focus the command palette button, press ?`,
		async reach(capture) {
			const page = await readyThread(capture);
			await page.getByRole('button', {name: 'command palette'}).focus();
			await page.keyboard.press('?');
			await expect(
				page.getByRole('dialog', {name: 'keyboard shortcuts', exact: true}),
			).toBeVisible();
		},
	},
	{
		stem: 'thread-menu',
		manifestId: 'thread-menu',
		fixture: 'extensions, no edits',
		how: `ready thread "${MAIN}", click its ⋯ actions in the thread rail`,
		async reach(capture) {
			const page = await readyThread(capture);
			const target = await threadMenu(page, MAIN);
			await expect(
				target.getByRole('button', {name: `rename: ${MAIN}`}),
			).toBeEnabled();
		},
	},
	{
		stem: 'thread-busy',
		manifestId: 'thread-busy',
		fixture: 'wait-for-cancel, no edits',
		how: `send "${MAIN}" (turn keeps running), click its ⋯ actions in the thread rail`,
		async reach(capture) {
			const page = await runningThread(capture);
			const target = await threadMenu(page, MAIN);
			await expect(
				target.getByRole('button', {name: `delete chat history: ${MAIN}`}),
			).toBeDisabled();
			await expect(
				target.getByText('wait for this thread to finish').first(),
			).toBeVisible();
		},
	},
	{
		stem: 'other-thread',
		manifestId: 'other-thread',
		fixture: 'wait-for-cancel, no edits',
		how: `send "${MAIN}" and cancel it, new thread, send "keyboard navigation" (keeps running), click "${MAIN}" in the rail; the composer shows the app's refusal "another thread is running" (the app has no dialog for this)`,
		async reach(capture) {
			const page = await openProject(capture, 'wait-for-cancel');
			await runningTurn(page, MAIN);
			await page
				.getByRole('button', {name: 'cancel turn', exact: true})
				.click();
			await expect(page.getByText('turn interrupted: cancelled')).toBeVisible(
				SLOW,
			);
			await newThread(page);
			await runningTurn(page, 'keyboard navigation');
			await row(page, MAIN).locator('.thread-open').click();
			await expect(
				page.locator('.thread-row[data-selected="true"] .thread-title'),
			).toHaveText(MAIN);
			await expect(page.getByText('another thread is running')).toBeVisible(
				SLOW,
			);
		},
	},
	{
		stem: 'toast',
		manifestId: 'toast',
		fixture: 'extensions, no edits',
		how: `nearest real toast, different copy: ready thread "${MAIN}", then before each shot the command palette runs "switch to <theme> theme", which shows the toast "switched to <theme> theme". The reference copy is "thread metadata imported. selection and draft unchanged."; the app shows no toast after an import, so the theme toast is the only toast the app shows`,
		async reach(capture) {
			await readyThread(capture);
		},
		async beforeShot(capture, theme) {
			// Toasts queue (2.4 s each), so wait for the previous one to leave first.
			await expect(capture.page.locator('.overlay-toast')).toHaveCount(0, {
				timeout: 15_000,
			});
			const palette = await openPalette(capture.page);
			await palette
				.getByRole('option', {name: `switch to ${theme} theme`})
				.click();
			await expect(capture.page.locator('.overlay-toast')).toContainText(
				`switched to ${theme} theme`,
			);
		},
	},
	{
		stem: 'archive',
		manifestId: 'archive',
		fixture: 'none',
		how: 'thread menu, archive',
		notReachable:
			'the app has no archive confirmation: "archive" in the thread menu (and the palette "archive thread" command) archives at once (source/renderer/app.tsx:325-327 onArchive calls controls.archive directly)',
	},
	{
		stem: 'archives',
		manifestId: 'archives',
		fixture: 'extensions, no edits',
		how: `send "earlier export research", new thread "keyboard navigation", new thread "${MAIN}" (each permission allowed), archive the first two from their ⋯ menus, expand "archived · 2" in the rail, open ⋯ on "earlier export research" to show unarchive (the app shows archived threads as a rail group, not a dialog)`,
		async reach(capture) {
			const page = await openProject(capture, 'extensions');
			await finishedTurn(page, 'earlier export research');
			await newThread(page);
			await finishedTurn(page, 'keyboard navigation');
			await newThread(page);
			await finishedTurn(page, MAIN);
			for (const title of ['earlier export research', 'keyboard navigation']) {
				const target = await threadMenu(page, title);
				await target
					.getByRole('button', {name: `archive: ${title}`, exact: true})
					.click();
				await expect(
					page.locator('.thread-group-heading', {hasText: 'archived'}),
				).toBeVisible();
			}
			const heading = page.locator('summary.thread-group-heading');
			await expect(heading).toHaveText('archived · 2');
			await heading.click();
			const archived = page.getByRole('list', {name: 'archived threads'});
			await expect(archived.locator('.thread-row')).toHaveCount(2);
			const target = await threadMenu(page, 'earlier export research');
			await expect(
				target.getByRole('button', {
					name: 'unarchive: earlier export research',
				}),
			).toBeEnabled();
		},
	},
	{
		stem: 'delete-history',
		manifestId: 'delete-history',
		fixture: 'none',
		how: 'thread menu, delete chat history',
		notReachable: `the delete chat history confirmation is a ${NATIVE} (source/main/ipc/index.ts:422 confirmDeleteHistory, copy at lines 425-428, native box at lines 434-436)`,
	},
	{
		stem: 'remove-thread',
		manifestId: 'remove-thread',
		fixture: 'none',
		how: 'thread menu, remove from desktop',
		notReachable:
			'the app has no remove confirmation: "remove from desktop" in the thread menu removes the desktop row at once (source/renderer/app.tsx:437-439 onRemove calls controls.remove directly, which calls removeThread)',
	},
	{
		stem: 'rename',
		manifestId: 'rename',
		fixture: 'extensions, no edits',
		how: `ready thread "${MAIN}", ⋯ actions, rename, type "${MAIN}" in the thread title field (not submitted)`,
		async reach(capture) {
			const page = await readyThread(capture);
			const target = await threadMenu(page, MAIN);
			await target
				.getByRole('button', {name: `rename: ${MAIN}`, exact: true})
				.click();
			const title = page
				.getByRole('dialog', {name: 'rename thread', exact: true})
				.getByRole('textbox', {name: 'thread title', exact: true});
			await expect(title).toBeFocused();
			await title.fill('');
			await title.pressSequentially(MAIN);
			await expect(title).toHaveValue(MAIN);
		},
	},
	{
		stem: 'diagnostics',
		manifestId: 'diagnostics',
		fixture: 'die-in-turn, no edits',
		how: `open project tide, send "${MAIN}" (Nanocoder exits with code 3), click diagnostics in the recovery row; stops at the in-app redacted review, before "review and export" (which opens native dialogs)`,
		async reach(capture) {
			const page = await openProject(capture, 'die-in-turn');
			await send(page, MAIN);
			const recovery = page.getByRole('region', {name: 'Nanocoder recovery'});
			await expect(recovery).toContainText('exit code 3', SLOW);
			await recovery
				.getByRole('button', {name: 'diagnostics', exact: true})
				.click();
			await expect(
				page.getByRole('region', {name: 'redacted diagnostics', exact: true}),
			).toBeVisible();
			await expect(
				page.getByRole('region', {name: 'captured diagnostics', exact: true}),
			).toBeVisible();
		},
	},
	{
		stem: 'yolo',
		manifestId: 'yolo',
		fixture: 'none',
		how: 'composer mode select, yolo',
		notReachable: `the yolo consent is a ${NATIVE} (source/main/controls/yolo-consent.ts:4 confirmYolo, copy at lines 11-20, called from source/main/ipc/index.ts:450-457)`,
	},
];
