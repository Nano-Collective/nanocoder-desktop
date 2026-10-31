import {expect, type Page} from '@playwright/test';
import {createDraftThread} from '../new-thread';
import {turnCancelled, turnEnded} from '../turn-state';
import type {Capture, CaptureState} from './harness';

const PALETTE_KEY = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
const SLOW = {timeout: 30_000};

const MAIN = 'export the audit log';
// One import per capture shot: 2 themes by 3 widths.
const IMPORTS = 6;
const IMPORTED = 'thread metadata imported. selection and draft unchanged.';

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
	await expect(turnEnded(page)).toBeVisible(SLOW);
	await expect(row(page, text)).toBeVisible();
}

async function runningTurn(page: Page, text: string): Promise<void> {
	await send(page, text);
	await expect(page.locator('.ui-badge--running')).toBeVisible(SLOW);
	await expect(page.getByText('Working on it.')).toBeVisible(SLOW);
}

async function newThread(page: Page): Promise<void> {
	await createDraftThread(
		page,
		page.getByRole('button', {name: 'new thread', exact: true}),
	);
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

async function headerThreadActions(page: Page) {
	await page.getByRole('button', {name: 'thread actions', exact: true}).click();
	const dialog = page.getByRole('dialog', {
		name: 'thread actions',
		exact: true,
	});
	await expect(dialog).toBeVisible();
	return dialog;
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
			await expect(
				palette.getByText('no commands found. try a different action name.'),
			).toBeVisible();
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
		how: `ready thread "${MAIN}", click the header "thread actions" button`,
		async reach(capture) {
			const page = await readyThread(capture);
			await headerThreadActions(page);
		},
		// Keep the transcript where it is under the dialog.
		async beforeShot() {},
	},
	{
		stem: 'thread-busy',
		manifestId: 'thread-busy',
		fixture: 'wait-for-cancel, no edits',
		how: `send "${MAIN}" (turn keeps running), click the header "thread actions" button; the dialog says "wait for this thread to finish" and archive, remove and rename are disabled`,
		async reach(capture) {
			const page = await runningThread(capture);
			const dialog = await headerThreadActions(page);
			await expect(
				dialog.getByText('wait for this thread to finish', {exact: true}),
			).toBeVisible();
			await expect(
				dialog.getByRole('button', {name: 'archive thread…', exact: true}),
			).toBeDisabled();
		},
		// Keep the transcript where it is under the dialog.
		async beforeShot() {},
	},
	{
		stem: 'other-thread',
		manifestId: 'other-thread',
		fixture: 'wait-for-cancel, no edits',
		how: `send "${MAIN}" and cancel it, new thread, send "keyboard navigation" (keeps running), click "${MAIN}" in the rail; the other-thread dialog "another thread is running" opens over the selected thread`,
		async reach(capture) {
			const page = await openProject(capture, 'wait-for-cancel');
			await runningTurn(page, MAIN);
			await page
				.getByRole('button', {name: 'cancel turn', exact: true})
				.click();
			await expect(page.getByText('turn interrupted')).toBeVisible(SLOW);
			await expect(turnCancelled(page)).toHaveCount(1);
			await newThread(page);
			await runningTurn(page, 'keyboard navigation');
			await row(page, MAIN).locator('.thread-open').click();
			await expect(
				page.locator('.thread-row[data-selected="true"] .thread-title'),
			).toHaveText(MAIN);
			await expect(
				page.getByRole('dialog', {
					name: 'another thread is running',
					exact: true,
				}),
			).toBeVisible(SLOW);
			await expect(
				page
					.locator('.composer-hint-row')
					.getByText('another thread is running'),
			).toBeVisible();
		},
	},
	{
		stem: 'toast',
		manifestId: 'toast',
		fixture: `session-discovery, ${IMPORTS} capture-only saved sessions ("earlier export research 1" to "${IMPORTS}")`,
		how: `ready project tide with ${IMPORTS} saved sessions offered; before each shot, import the first offered session from the saved sessions list, which shows the toast "${IMPORTED}". Each toast lasts 2.4 s, so each shot needs its own import`,
		fixtureEdits: [
			{
				from: "'session/list': () =>",
				to: `'session/list': () =>
		mode === 'session-discovery'
			? {sessions: Array.from({length: ${IMPORTS}}, (_, index) => ({sessionId: \`capture-session-\${index + 1}\`, cwd: process.cwd(), title: \`earlier export research \${index + 1}\`, updatedAt: '2026-10-29T12:00:00.000Z'}))}
			:`,
			},
		],
		async reach(capture) {
			const page = await openProject(capture, 'session-discovery');
			await send(page, MAIN);
			await expect(page.getByText('turn ended: end_turn')).toBeVisible(SLOW);
			await expect(row(page, MAIN)).toBeVisible();
		},
		async beforeShot(capture) {
			const page = capture.page;
			// Toasts queue, so wait for the previous one to leave before importing again.
			await expect(page.locator('.overlay-toast')).toHaveCount(0, {
				timeout: 15_000,
			});
			const next = page.locator('.session-import button').first();
			await expect(next).toBeEnabled(SLOW);
			await next.click();
			await expect(page.locator('.overlay-toast')).toHaveText(IMPORTED);
		},
	},
	{
		stem: 'archive',
		manifestId: 'archive',
		fixture: 'extensions, no edits',
		how: `ready thread "${MAIN}", its ⋯ actions, archive; the confirmation holds focus on cancel`,
		async reach(capture) {
			const page = await readyThread(capture);
			const target = await threadMenu(page, MAIN);
			await target
				.getByRole('button', {name: `archive: ${MAIN}`, exact: true})
				.click();
			const dialog = page.getByRole('dialog', {
				name: 'archive thread',
				exact: true,
			});
			await expect(dialog).toBeVisible();
			await expect(
				dialog.getByRole('button', {name: 'cancel', exact: true}),
			).toBeFocused();
		},
	},
	{
		stem: 'archives',
		manifestId: 'archives',
		fixture: 'extensions, no edits',
		how: `send "earlier export research", new thread "keyboard navigation", new thread "${MAIN}" (each permission allowed), archive the first two from their ⋯ menus and confirm each archive dialog, open the rail's "archived 2" link to show the archived threads dialog with unarchive`,
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
				await page
					.getByRole('dialog', {name: 'archive thread', exact: true})
					.getByRole('button', {name: 'archive thread', exact: true})
					.click();
				await expect(row(page, title)).toHaveCount(0);
			}
			const opener = page.getByRole('button', {name: /^archived/});
			await expect(opener).toContainText('2');
			await opener.click();
			const dialog = page.getByRole('dialog', {
				name: 'archived threads',
				exact: true,
			});
			await expect(dialog).toBeVisible();
			const archived = dialog.getByRole('list', {
				name: 'archived threads',
				exact: true,
			});
			await expect(archived.locator('.archives-dialog-row')).toHaveCount(2);
			await expect(
				dialog.getByRole('button', {
					name: 'unarchive earlier export research',
					exact: true,
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
		fixture: 'extensions, no edits',
		how: `ready thread "${MAIN}", its ⋯ actions, remove from desktop; the confirmation holds focus on cancel`,
		async reach(capture) {
			const page = await readyThread(capture);
			const target = await threadMenu(page, MAIN);
			await target
				.getByRole('button', {
					name: `remove from desktop: ${MAIN}`,
					exact: true,
				})
				.click();
			const dialog = page.getByRole('dialog', {
				name: 'remove from desktop',
				exact: true,
			});
			await expect(dialog).toBeVisible();
			await expect(
				dialog.getByRole('button', {name: 'cancel', exact: true}),
			).toBeFocused();
		},
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
		how: `open project tide, send "${MAIN}" (Nanocoder exits with code 3), click diagnostics in the recovery row; stops at the "review captured diagnostics" dialog, before "choose export destination…" (which opens a native dialog)`,
		async reach(capture) {
			const page = await openProject(capture, 'die-in-turn');
			await send(page, MAIN);
			const recovery = page.getByRole('region', {name: 'Nanocoder recovery'});
			await expect(recovery).toContainText('exit code 3', SLOW);
			await recovery
				.getByRole('button', {name: 'diagnostics', exact: true})
				.click();
			const review = page.getByRole('dialog', {
				name: 'review captured diagnostics',
			});
			await expect(review).toBeVisible();
			await expect(
				review.getByRole('region', {name: 'redacted diagnostics', exact: true}),
			).toBeVisible();
			await expect(
				review.getByRole('region', {name: 'captured diagnostics', exact: true}),
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
