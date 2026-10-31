import {rmSync} from 'node:fs';
import {expect} from '@playwright/test';
import type {Capture, CaptureState, FixtureEdit} from './harness';

const native =
	'native message box from dialog.showMessageBox (confirmProjectTrust in source/main/projects/project-consent.ts:14, copy at lines 24-35, called from source/main/ipc/index.ts:119-127); it is drawn by the OS outside the renderer page, so a page screenshot cannot include it, and the capture harness stubs it to answer without showing it';

const savedSessions: readonly FixtureEdit[] = [
	{from: ": 'existing saved session',", to: ": 'earlier export research',"},
	{
		from: "updatedAt: '2026-10-29T12:00:00.000Z',",
		to: "updatedAt: '2026-10-29T16:20:00.000Z'}, {sessionId: 'saved-table-navigation', cwd: process.cwd(), title: 'table navigation checks', updatedAt: '2026-10-26T09:15:00.000Z',",
	},
];

const savedSessionsText =
	'session/list returns two sessions titled "earlier export research" (29 Oct 16:20 UTC) and "table navigation checks" (26 Oct 09:15 UTC) instead of one "existing saved session"';

function message(capture: Capture) {
	return capture.page.getByRole('textbox', {name: 'message', exact: true});
}

async function openReady(capture: Capture, folder: string, name: string) {
	await capture.openProject(folder);
	await expect(capture.page.locator('.project-switch-name')).toContainText(
		name,
	);
	await expect(message(capture)).toBeEnabled();
	await expect(capture.page.locator('.ui-badge--acp-ready')).toBeVisible();
}

// One finished turn so the dialog backdrop is a ready conversation, not an empty draft.
async function readyConversation(capture: Capture) {
	await openReady(capture, capture.project('tide', 'reported-usage'), 'tide');
	await message(capture).fill(
		'add CSV export to the audit log. keep the existing filter and make the download usable from the keyboard.',
	);
	await capture.page.getByRole('button', {name: 'send', exact: true}).click();
	await expect(
		capture.page.getByText('Reported usage fixture.', {exact: true}),
	).toBeVisible();
	await expect(message(capture)).toBeEnabled();
}

function imports(capture: Capture) {
	return capture.page.getByRole('region', {
		name: 'import saved sessions',
		exact: true,
	});
}

async function openRuntimeDetails(capture: Capture) {
	await capture.page
		.getByRole('button', {name: 'runtime details', exact: true})
		.click();
	await expect(
		capture.page.getByRole('dialog', {name: 'runtime details'}),
	).toBeVisible();
}

export const states: CaptureState[] = [
	{
		stem: 'welcome-main',
		manifestId: 'welcome-main',
		fixture: 'fake mode untrusted for both folders, no edits',
		how: 'picked atlas-notes then tide (recents list newest first) with the folder picker and answered Cancel on the native trust prompt each time (a trusted open restores the project and its thread after restart, so the welcome screen would not show), then restarted on the same profile; the welcome screen lists both as recent projects with no project selected',
		async reach(capture) {
			await capture.nativeAnswer(1);
			const recents = () =>
				capture.page.getByRole('region', {name: 'recent folders on welcome'});
			for (const name of ['atlas-notes', 'tide']) {
				await capture.openProject(capture.project(name, 'untrusted'));
				await expect(recents()).toContainText(name);
				await expect(
					capture.page.getByRole('button', {
						name: 'open a project folder',
						exact: true,
					}),
				).toBeEnabled();
			}
			await capture.restart();
			await expect(
				capture.page.getByRole('region', {name: 'get started'}),
			).toBeVisible();
			await expect(recents()).toContainText('atlas-notes');
			await expect(recents()).toContainText('tide');
			await expect(capture.page.locator('.project-switch-name')).toContainText(
				'choose a project',
			);
		},
	},
	{
		stem: 'trust-main',
		manifestId: 'trust-main',
		fixture: 'none',
		how: 'not captured',
		notReachable: `the trust prompt is a ${native}`,
	},
	{
		stem: 'trust',
		manifestId: 'trust',
		fixture: 'none',
		how: 'not captured',
		notReachable: `the trust prompt is a ${native}`,
	},
	{
		stem: 'import-main',
		manifestId: 'import-main',
		fixture: `fake mode ok (default); edits: ${savedSessionsText}`,
		how: 'opened tide through the folder picker, waited for the ready ACP badge and both offers in the sidebar "import saved sessions" region, scrolled that region into view before each shot',
		fixtureEdits: savedSessions,
		async reach(capture) {
			await openReady(capture, capture.project('tide'), 'tide');
			for (const title of [
				'earlier export research',
				'table navigation checks',
			])
				await expect(
					imports(capture).getByRole('button', {
						name: `import saved session: ${title}`,
						exact: true,
					}),
				).toBeEnabled();
		},
		async beforeShot(capture) {
			await imports(capture).scrollIntoViewIfNeeded();
		},
	},
	{
		stem: 'projects',
		manifestId: 'projects',
		fixture: `fake mode reported-usage for tide, ok for the others; edits: ${savedSessionsText}`,
		fixtureEdits: savedSessions,
		how: 'opened field-guide and atlas-notes, deleted the field-guide folder, opened tide and sent one message, then clicked the "switch project" button to open the "your projects" dialog',
		async reach(capture) {
			const fieldGuide = capture.project('field-guide');
			await openReady(capture, fieldGuide, 'field-guide');
			await openReady(capture, capture.project('atlas-notes'), 'atlas-notes');
			rmSync(fieldGuide, {recursive: true, force: true});
			await readyConversation(capture);
			await capture.page
				.getByRole('button', {name: 'switch project', exact: true})
				.click();
			const dialog = capture.page.getByRole('dialog', {
				name: 'your projects',
			});
			await expect(dialog).toBeVisible();
			const list = dialog.getByRole('region', {name: 'recent projects'});
			await expect(list).toContainText('folder missing');
		},
	},
	{
		stem: 'runtime',
		manifestId: 'runtime',
		fixture: `fake mode reported-usage; edits: ${savedSessionsText}`,
		fixtureEdits: savedSessions,
		how: 'opened tide and sent one message, then clicked the "runtime details" button in the conversation workspace; the "runtime details" dialog shows the Nanocoder version, Node.js, process, project root and CLI paths',
		async reach(capture) {
			await readyConversation(capture);
			await openRuntimeDetails(capture);
		},
	},
	{
		stem: 'capabilities',
		manifestId: 'capabilities',
		fixture: `fake mode reported-usage; edits: ${savedSessionsText}`,
		fixtureEdits: savedSessions,
		how: 'opened tide, sent one message, clicked "runtime details", then "capabilities"; the "capabilities, with reasons" dialog lists each Nanocoder feature gate with its reason',
		async reach(capture) {
			await readyConversation(capture);
			await openRuntimeDetails(capture);
			await capture.page
				.getByRole('dialog', {name: 'runtime details'})
				.getByRole('button', {name: 'capabilities', exact: true})
				.click();
			await expect(
				capture.page.getByRole('dialog', {
					name: 'capabilities, with reasons',
				}),
			).toBeVisible();
		},
	},
];
