import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect, type Page} from '@playwright/test';
import {turnEnded} from '../turn-state';
import type {Capture, CaptureState, FixtureEdit} from './harness';

const PROMPT =
	'add CSV export to the audit log. keep the existing filter and make the download usable from the keyboard.';
const TITLE = 'export the audit log';

const input = (page: Page) =>
	page.getByRole('textbox', {name: 'message', exact: true});
const selectedRow = (page: Page) =>
	page.locator('.thread-row[data-selected="true"]');

async function openTide(capture: Capture, mode: string): Promise<string> {
	const folder = capture.project('tide', mode);
	await capture.openProject(folder);
	await expect(input(capture.page)).toBeEnabled();
	return folder;
}

async function send(capture: Capture, text: string): Promise<void> {
	await input(capture.page).fill(text);
	await input(capture.page).press('Enter');
}

// A manual title set before the first prompt is kept instead of the prompt-derived one.
async function rename(capture: Capture, title: string): Promise<void> {
	const row = selectedRow(capture.page);
	const menu = row.locator('.thread-actions');
	await menu.locator('> summary').click();
	await row.getByRole('button', {name: /^rename: /}).click();
	const dialog = capture.page.getByRole('dialog', {
		name: 'rename thread',
		exact: true,
	});
	await dialog
		.getByRole('textbox', {name: 'thread title', exact: true})
		.fill(title);
	await capture.page.keyboard.press('Enter');
	await expect(dialog).toHaveCount(0);
	await expect(row.locator('.thread-title')).toHaveText(title);
	await menu.locator('> summary').click();
	await expect(menu).not.toHaveAttribute('open');
}

// Wheel-scrolls the transcript to its end, as a reader would after a reflow.
async function scrollToEnd(capture: Capture): Promise<void> {
	const list = capture.page.getByRole('list', {name: 'conversation'});
	if ((await list.count()) === 0) return;
	await list.hover();
	const atEnd = () =>
		list.evaluate(element => {
			let node: Element | null = element;
			while (node && node.scrollHeight <= node.clientHeight + 1)
				node = node.parentElement;
			return (
				!node || node.scrollTop + node.clientHeight >= node.scrollHeight - 2
			);
		});
	await expect
		.poll(async () => {
			await capture.page.mouse.wheel(0, 4000);
			return atEnd();
		})
		.toBe(true);
}

async function scrollToTop(capture: Capture): Promise<void> {
	const list = capture.page.getByRole('list', {name: 'conversation'});
	if ((await list.count()) === 0) return;
	await list.hover();
	const atTop = () =>
		list.evaluate(element => {
			let node: Element | null = element;
			while (node && node.scrollHeight <= node.clientHeight + 1)
				node = node.parentElement;
			return !node || node.scrollTop <= 1;
		});
	await expect
		.poll(async () => {
			await capture.page.mouse.wheel(0, -4000);
			return atTop();
		})
		.toBe(true);
}

const update = (body: string) =>
	`notify('session/update', {sessionId, update: ${body}});`;
const thought = (text: string) =>
	update(
		`{sessionUpdate: 'agent_thought_chunk', content: {type: 'text', text: '${text}'}}`,
	);
const toolRow = (id: string, title: string, kind: string, status: string) =>
	update(
		`{sessionUpdate: 'tool_call', toolCallId: '${id}', title: '${title}', kind: '${kind}', status: '${status}'}`,
	);
const INTRO = String.raw`say(sessionId, '## a small, predictable export\n\ni\'ll keep the table behaviour unchanged and add one export path for the rows you can already see.\n\n');`;
const DONE_TOOLS = [
	toolRow('read_export', 'read src/export.ts', 'read', 'completed'),
	toolRow('edit_export', 'edit src/export.ts', 'edit', 'completed'),
].join('\n');
const CHECKS = String.raw`say(sessionId, '- uses the active filter and sort order\n- escapes commas, quotes and line breaks\n- keeps focus on the export button after download\n\n| check | result |\n| --- | --- |\n| pnpm test:unit -- export | passed |\n| keyboard download | passed |');`;

// Gives every new session a reported model option named like the reference.
const MODEL_EDITS: readonly FixtureEdit[] = [
	{
		from: "let replayModel = 'old';",
		to: "let replayModel = 'qwen3-coder:30b';",
	},
	{
		from: "{name: 'old', value: 'old'},",
		to: "{name: 'qwen3-coder:30b', value: 'qwen3-coder:30b'},",
	},
	{
		from: "...(mode === 'replay-gates' && {configOptions: replayConfig()}),",
		to: 'configOptions: replayConfig(),',
	},
];

// reported-usage turn: reasoning, two completed tools, a markdown answer with checks, reported usage.
const READY_EDITS: readonly FixtureEdit[] = [
	...MODEL_EDITS,
	{
		from: "say(sessionId, 'Reported usage fixture.');",
		to: [
			thought('checking how the table filter feeds the visible rows'),
			INTRO,
			DONE_TOOLS,
			CHECKS,
		].join('\n'),
	},
];
const READY_FIXTURE =
	'reported-usage; edits: answer text swapped for a reasoning chunk, "a small, predictable export" heading and paragraph, completed tools "read src/export.ts" and "edit src/export.ts", three bullets and a markdown checks table; model edits: session/new reports a model option "qwen3-coder:30b" (fixture replayConfig made unconditional)';

async function readyConversation(capture: Capture): Promise<void> {
	await openTide(capture, 'reported-usage');
	await rename(capture, TITLE);
	await send(capture, PROMPT);
	await expect(turnEnded(capture.page)).toBeVisible();
	await expect(input(capture.page)).toBeEnabled();
}

async function tabTo(page: Page, name: string): Promise<void> {
	const target = page.getByRole('combobox', {name, exact: true});
	await expect(target).toBeEnabled();
	if (await target.evaluate(element => element === document.activeElement))
		return;
	await input(page).focus();
	for (let step = 0; step < 12; step++) {
		await page.keyboard.press('Tab');
		if (await target.evaluate(element => element === document.activeElement))
			break;
	}
	await expect(target).toBeFocused();
}

const MODE_SELECT = 'mode for this thread';
const MODEL_SELECT = 'model for every thread in project tide';

const drivers: CaptureState[] = [
	{
		stem: 'conversation-ready',
		manifestId: 'conversation-ready',
		fixture: READY_FIXTURE,
		how: 'open project folder "tide", rename the new thread to "export the audit log" from the thread menu, type the CSV export prompt and press Enter, wait for the turn to end, transcript scrolled to the top',
		fixtureEdits: READY_EDITS,
		reach: readyConversation,
		beforeShot: scrollToTop,
	},
	{
		stem: 'conversation-running',
		manifestId: 'conversation-running',
		fixture:
			'wait-for-cancel; edits: "Working on it." swapped for a reasoning chunk, the reference heading and paragraph, completed read/edit tools, an in-progress tool "execute_bash: pnpm test:unit -- export" and the text "checking the result"; model edits as in conversation-ready',
		how: 'open "tide", rename the thread to "export the audit log", send the CSV export prompt; the turn stays running until cancelled, shown with the "cancel turn" control, transcript scrolled to the top',
		beforeShot: scrollToTop,
		fixtureEdits: [
			...MODEL_EDITS,
			{
				from: "say(sessionId, 'Working on it. ');",
				to: [
					thought('checking how the table filter feeds the visible rows'),
					INTRO,
					DONE_TOOLS,
					toolRow(
						'test_export',
						'execute_bash: pnpm test:unit -- export',
						'execute',
						'in_progress',
					),
					"say(sessionId, 'checking the result');",
				].join('\n'),
			},
		],
		async reach(capture) {
			await openTide(capture, 'wait-for-cancel');
			await rename(capture, TITLE);
			await send(capture, PROMPT);
			await expect(capture.page.getByText('checking the result')).toBeVisible();
			await expect(
				capture.page.getByRole('button', {name: 'cancel turn', exact: true}),
			).toBeVisible();
		},
	},
	{
		stem: 'conversation-approval',
		manifestId: 'conversation-approval',
		fixture:
			'ok (default); edits: tool title "execute_bash: echo hi" to "execute_bash: pnpm test:unit -- export", offered options changed from Allow/Deny to three: "allow once" (allow_once), "allow always" (allow_always), "reject" (reject_once), "Working on it." swapped for the reference heading and paragraph, the reference read and edit tool rows added above the shelf, and the request\'s own pending tool row kept as the product renders it (the reference has none, gap D-14, so the capture shows three tool rows against two); model edits as in conversation-ready',
		how: 'open "tide", rename the thread to "export the audit log", send the CSV export prompt; the permission request takes focus in the approval shelf',
		fixtureEdits: [
			...MODEL_EDITS,
			{
				from: "'execute_bash: echo hi'",
				to: "'execute_bash: pnpm test:unit -- export'",
			},
			{
				from: "{optionId: 'allow', name: 'Allow', kind: 'allow_once'},",
				to: "{optionId: 'allow', name: 'allow once', kind: 'allow_once'},\n\t{optionId: 'allow-always', name: 'allow always', kind: 'allow_always'},",
			},
			{
				from: "{optionId: 'deny', name: 'Deny', kind: 'reject_once'},",
				to: "{optionId: 'deny', name: 'reject', kind: 'reject_once'},",
			},
			{
				from: "say(sessionId, 'Working on it. ');",
				to: [INTRO, DONE_TOOLS].join('\n'),
			},
		],
		async reach(capture) {
			await openTide(capture, 'ok');
			await rename(capture, TITLE);
			await send(capture, PROMPT);
			const card = capture.page.getByRole('region', {
				name: 'permission request',
			});
			await expect(card.getByRole('button')).toHaveCount(3);
			await expect(capture.page.getByRole('alertdialog')).toBeFocused();
		},
	},
	{
		stem: 'conversation-failed',
		manifestId: 'conversation-failed',
		fixture:
			'die-in-turn (the fake process exits with code 3 when a prompt arrives); edits: the exit also leaves a .fake-died marker, and a die-in-turn start with that marker exits with code 3, so the first automatic restart fails and the notice stays still for every shot',
		how: 'open "tide", rename the thread to "export the audit log", send the CSV export prompt; Nanocoder exits during the turn; its scheduled automatic restart also exits, which stops automatic recovery; the recovery notice shows retry and diagnostics beside the failed turn',
		fixtureEdits: [
			{
				from: "if (mode === 'die-in-turn') process.exit(3);",
				to: "if (mode === 'die-in-turn') {\n\t\twriteFileSync('.fake-died', '');\n\t\tprocess.exit(3);\n\t}",
			},
			{
				from: "if (mode === 'refuse') {",
				to: "if (mode === 'die-in-turn' && existsSync('.fake-died')) {\n\tprocess.exitCode = 3;\n} else if (mode === 'refuse') {",
			},
		],
		async reach(capture) {
			await openTide(capture, 'die-in-turn');
			await rename(capture, TITLE);
			await send(capture, PROMPT);
			const recovery = capture.page
				.getByRole('region', {name: 'Nanocoder recovery'})
				.first();
			await expect(recovery).toContainText('exit code 3');
			await expect(recovery).toContainText(
				'Nanocoder stopped before it was ready (exit code 3)',
				{timeout: 15_000},
			);
			await expect(recovery.getByRole('button')).toHaveText([
				'retry Nanocoder',
				'diagnostics',
			]);
		},
	},
	{
		stem: 'conversation-view-only',
		manifestId: 'conversation-view-only',
		fixture:
			'reported-usage for the first launch, then the project mode file is changed to missing-session (resume answers "Session not found on disk") before relaunch',
		how: 'open "tide", rename the thread to "earlier export research", send a prompt and wait for the turn to end; quit and relaunch the app on the same profile, then open the saved thread; Nanocoder cannot find the session, so the thread is view-only and the composer is hidden',
		async reach(capture) {
			const folder = await openTide(capture, 'reported-usage');
			await rename(capture, 'earlier export research');
			await send(capture, 'research how the audit log could export CSV');
			await expect(turnEnded(capture.page)).toBeVisible();
			writeFileSync(path.join(folder, '.fake-nanocoder'), 'missing-session');
			await capture.restart();
			await openViewOnly(capture, folder);
		},
	},
	{
		stem: 'subagents-main',
		manifestId: 'subagents-main',
		fixture:
			'subagents; edits: the delegation title "explore: inspect fixture" to "explore: check CSV edge cases" and its description to "check CSV edge cases", and the "no approval" branch made the default for prompts without the word "approval" so the turn keeps running with no permission request; model edits as in conversation-ready',
		how: 'open "tide", rename the thread to "check the export flow", send "check the CSV export flow. delegate an edge-case review if useful."; the reported subagent card shows with the whole-turn stop control',
		fixtureEdits: [
			...MODEL_EDITS,
			{
				from: "title: fallback ? 'agent' : 'explore: inspect fixture',",
				to: "title: fallback ? 'agent' : 'explore: check CSV edge cases',",
			},
			{
				from: "description: 'inspect fixture',",
				to: "description: 'check CSV edge cases',",
			},
			{
				from: "if (text.includes('no approval') || fallback) {",
				to: "if (!text.includes('approval') || fallback) {",
			},
		],
		async reach(capture) {
			await openTide(capture, 'subagents');
			await rename(capture, 'check the export flow');
			await send(
				capture,
				'check the CSV export flow. delegate an edge-case review if useful.',
			);
			await expect(capture.page.locator('.subagent-run-card')).toHaveCount(1);
			await expect(
				capture.page.getByRole('button', {
					name: /stop whole turn:.*entire turn and all subagents/,
				}),
			).toBeVisible();
		},
	},
	{
		stem: 'question',
		manifestId: 'question',
		fixture:
			'ask-user; edits: question "Which fixture option?" to "which rows should the export include?", options "First choice"/"Second choice" to "current filtered rows"/"all rows", "Working on it." swapped for the reference heading and paragraph; model edits as in conversation-ready',
		how: 'open "tide", rename the thread to "export the audit log", send the CSV export prompt; Nanocoder asks a question with two offered choices and no free-text field',
		fixtureEdits: [
			...MODEL_EDITS,
			{
				from: "'Which fixture option?'",
				to: "'which rows should the export include?'",
			},
			{
				from: "name: 'First choice'",
				to: "name: 'current filtered rows'",
			},
			{from: "name: 'Second choice'", to: "name: 'all rows'"},
			{
				from: "options: ['First choice', 'Second choice'],",
				to: "options: ['current filtered rows', 'all rows'],",
			},
			{from: "say(sessionId, 'Working on it. ');", to: INTRO},
		],
		async reach(capture) {
			await openTide(capture, 'ask-user');
			await rename(capture, TITLE);
			await send(capture, PROMPT);
			const question = capture.page.getByRole('alertdialog', {
				name: 'Nanocoder needs a choice',
			});
			await expect(question).toContainText(
				'which rows should the export include?',
			);
			await expect(question.locator('.question-choice')).toHaveCount(2);
			await expect(question.getByRole('textbox')).toHaveCount(0);
			await expect(
				question.getByRole('button', {name: 'close choice', exact: true}),
			).toBeFocused();
		},
		// The modal question makes the transcript inert, so it cannot be wheel-scrolled.
		async beforeShot(capture) {
			await capture.page
				.getByRole('list', {name: 'conversation'})
				.evaluate(element => {
					let node: Element | null = element;
					while (node && node.scrollHeight <= node.clientHeight + 1)
						node = node.parentElement;
					if (node) node.scrollTop = node.scrollHeight;
				});
			await expect(
				capture.page.getByRole('alertdialog', {
					name: 'Nanocoder needs a choice',
				}),
			).toHaveJSProperty('open', true);
		},
	},
	{
		stem: 'new',
		manifestId: 'new',
		fixture: READY_FIXTURE,
		how: 'reach conversation-ready, click "new thread" in the sidebar; the new thread dialog stays open with its draft field, "cancel" and "keep as new thread draft" (the session is created on the first send)',
		fixtureEdits: READY_EDITS,
		async reach(capture) {
			await readyConversation(capture);
			await capture.page
				.getByRole('region', {name: 'project threads'})
				.getByRole('button', {name: 'new thread', exact: true})
				.click();
			const dialog = capture.page.getByRole('dialog', {
				name: 'new thread',
				exact: true,
			});
			await expect(dialog).toBeVisible();
			await expect(
				dialog.getByRole('heading', {name: 'new thread in tide', exact: true}),
			).toBeVisible();
			await expect(
				dialog.getByRole('button', {
					name: 'keep as new thread draft',
					exact: true,
				}),
			).toBeVisible();
		},
	},
	{
		stem: 'mode-control',
		manifestId: 'mode-control',
		fixture: READY_FIXTURE,
		how: 'reach conversation-ready, focus the composer and press Tab until the "mode for this thread" select has keyboard focus',
		fixtureEdits: READY_EDITS,
		async reach(capture) {
			await readyConversation(capture);
			await tabTo(capture.page, MODE_SELECT);
		},
		async beforeShot(capture) {
			await scrollToEnd(capture);
			await tabTo(capture.page, MODE_SELECT);
		},
	},
	{
		stem: 'model-control',
		manifestId: 'model-control',
		fixture: READY_FIXTURE,
		how: 'reach conversation-ready, focus the composer and press Tab until the model select has keyboard focus',
		fixtureEdits: READY_EDITS,
		async reach(capture) {
			await readyConversation(capture);
			await tabTo(capture.page, MODEL_SELECT);
		},
		async beforeShot(capture) {
			await scrollToEnd(capture);
			await tabTo(capture.page, MODEL_SELECT);
		},
	},
];

export const states: CaptureState[] = drivers.map(state =>
	state.beforeShot ? state : {...state, beforeShot: scrollToEnd},
);

async function openViewOnly(capture: Capture, folder: string): Promise<void> {
	const notice = capture.page.getByRole('region', {
		name: 'view-only thread',
		exact: true,
	});
	const thread = capture.page
		.locator('.thread-row')
		.filter({hasText: 'earlier export research'})
		.locator('.thread-open');
	await expect(
		notice
			.or(thread)
			.or(capture.page.getByRole('button', {name: 'open a project folder'}))
			.first(),
	).toBeVisible();
	if (!(await notice.isVisible())) {
		if (!(await thread.isVisible())) await capture.openProject(folder);
		await thread.click();
	}
	await expect(notice).toBeVisible();
	await expect(input(capture.page)).toHaveCount(0);
}
