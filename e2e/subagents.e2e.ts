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
import {DatabaseSync} from 'node:sqlite';
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from '@playwright/test';
import {build} from 'vite';
import {qaEnvironment} from './qa/environment';
import type {subagentHarness} from './qa/subagent-harness';
import {visibleTextContrast} from './qa/ui-contrast';

const root = path.resolve(import.meta.dirname, '..');
const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-subagents-')),
);
let app: ElectronApplication;
let page: Page;
type HarnessWindow = {
	subagentFixture: {subagentHarness: typeof subagentHarness};
};

test.beforeAll(async () => {
	const cli = path.join(work, 'nanocoder/dist/cli.js');
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
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	page = await app.firstWindow();
	expect(page.url()).toMatch(/^app:\/\/renderer\//);
});

test.describe('fc01-shaped delegation cards', () => {
	const cards = () => page.locator('.subagent-run-card');
	const input = () => page.getByRole('textbox', {name: 'message', exact: true});
	const stop = () =>
		page.getByRole('button', {
			name: /stop turn:.*entire turn and all subagents/,
		});
	async function prompt(text: string) {
		await input().fill(text);
		await input().press('Enter');
	}
	test.beforeAll(async () => {
		const project = path.join(work, 'project');
		mkdirSync(project);
		writeFileSync(path.join(project, '.fake-nanocoder'), 'subagents');
		await app.evaluate(({dialog}, folder) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [folder],
			})) as typeof dialog.showOpenDialog;
		}, project);
		await page
			.getByRole('button', {name: 'open a project folder', exact: true})
			.click();
		await expect(input()).toBeEnabled();
	});

	test('flat cards retain task and reported progress with one attributed approval queue (SUB-01/02/03)', async () => {
		await prompt('fixture approval');
		await expect(cards()).toHaveCount(1);
		await expect(cards().last()).toContainText('inspect fixture');
		await expect(cards().last()).toContainText('1.2k tokens');
		await expect(cards().last()).toContainText('3 tools (read_file)');
		await expect(cards().last()).toContainText('depth not reported');
		await expect(page.getByRole('alertdialog')).toHaveCount(1);
		await expect(page.getByRole('alertdialog')).toContainText(
			'execute_bash fixture (explore)',
		);
		await expect(page.getByRole('alertdialog')).toContainText(
			'may still fail afterwards',
		);
		await expect(page.getByRole('alertdialog')).toBeFocused();
		await expect(cards().last()).not.toContainText('private fixture task');
		await stop().click();
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(cards().last()).toContainText('interrupted');
	});

	test('approved inner tool is not shown as successful when the delegation fails (SUB-03)', async () => {
		await prompt('fixture failure');
		await expect(cards().first()).toContainText('interrupted');
		await expect(page.getByRole('alertdialog')).toHaveCount(1);
		await page
			.getByRole('alertdialog')
			.getByRole('button', {name: 'Allow'})
			.click();
		await expect(
			page.getByText('turn ended: end_turn', {exact: true}),
		).toBeVisible();
		await expect(cards().last()).toContainText('failed');
		await expect(
			page
				.locator('.gate-message-tool')
				.filter({hasText: 'execute_bash fixture (explore)'})
				.last(),
		).toContainText('approved · execution result not reported');
		await expect(stop()).toHaveCount(0);
	});

	test('stop without approval preserves the editable running draft (SUB-04)', async () => {
		await prompt('fixture no approval');
		await expect(stop()).toHaveCount(1);
		await input().fill('unsent fixture draft');
		await expect(
			page.getByRole('button', {name: 'send', exact: true}),
		).toBeDisabled();
		await stop().focus();
		await stop().press('Enter');
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
		await expect(input()).toHaveValue('unsent fixture draft');
		await expect(input()).toBeFocused();
		await expect(cards().last()).toContainText('interrupted');
	});

	test('same-name cards never claim ambiguous approvals and one stop closes every pending request (SUB-03/04)', async () => {
		await prompt('fixture two approvals');
		await expect(stop()).toHaveCount(2);
		await expect(page.getByRole('alertdialog')).toHaveCount(2);
		const names = await cards().evaluateAll(elements =>
			elements.map(element => element.getAttribute('aria-label')),
		);
		expect(new Set(names).size).toBe(names.length);
		expect(names.slice(-2)).toEqual([
			`subagent run ${names.length - 1} of ${names.length}: explore`,
			`subagent run ${names.length} of ${names.length}: explore`,
		]);
		await expect(
			page.getByRole('region', {
				name: 'permission request 1 of 2',
				exact: true,
			}),
		).toHaveCount(1);
		await expect(
			page.getByRole('region', {
				name: 'permission request 2 of 2',
				exact: true,
			}),
		).toHaveCount(1);
		for (const dialog of await page.getByRole('alertdialog').all())
			await expect(dialog).toContainText('parent run not reported');
		await expect(
			cards().filter({has: page.getByRole('alertdialog')}),
		).toHaveCount(0);
		await stop().first().click();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(stop()).toHaveCount(0);
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
	});

	test('thin delegation safely falls back and source bounds are not settings (SUB-06/07)', async () => {
		const retained = await cards().allTextContents();
		await prompt('fixture fallback');
		await expect(cards()).toHaveCount(retained.length + 1);
		await expect(cards().last()).toContainText('child details not available');
		await expect(cards().last()).toContainText(
			'source bounds: depth 2, batch 5',
		);
		await expect(cards().last()).toContainText('elapsed not reported');
		await expect(cards().last().getByRole('combobox')).toHaveCount(0);
		await cards()
			.last()
			.getByRole('button', {
				name: /stop turn:.*entire turn and all subagents/,
			})
			.click();
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
		for (const [index, text] of retained.entries())
			await expect(cards().nth(index)).toHaveText(text);
	});

	for (const theme of ['dark', 'light'] as const) {
		test(`card focus, wrapping and reduced motion in ${theme} at three widths (U.7)`, async () => {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			await prompt('fixture no approval');
			await page.emulateMedia({reducedMotion: 'reduce'});
			for (const width of [1240, 1020, 840]) {
				await page.setViewportSize({width, height: 900});
				await stop().focus();
				await expect(stop()).toBeFocused();
				expect(
					await stop().evaluate(
						element => getComputedStyle(element).outlineWidth,
					),
				).toBe('2px');
				const box = await cards().last().boundingBox();
				expect(box?.width).toBeGreaterThan(200);
				expect(
					await cards()
						.last()
						.evaluate(element => element.scrollWidth <= element.clientWidth),
				).toBe(true);
				expect(await visibleTextContrast(page, theme)).toEqual([]);
			}
			await stop().press('Enter');
			await expect(
				page.getByText('turn interrupted: cancelled', {exact: true}),
			).toBeVisible();
			await page.emulateMedia({reducedMotion: 'no-preference'});
			await page.setViewportSize({width: 1240, height: 900});
		});
	}

	test('SUB-05 production delegations commit exact scoped execution-linked metadata without task content', async () => {
		const {readFileSync, existsSync} = await import('node:fs');
		await page.getByRole('button', {name: 'new thread', exact: true}).click();
		await expect(
			page.locator('.thread-row[data-selected="true"] .thread-title'),
		).toHaveText('new thread');
		const scope = await page.evaluate(async () => {
			const {desktop} = window as unknown as {
				desktop: import('@/shared/desktop-api').DesktopApi;
			};
			const ui = await desktop.getUiState({});
			if (!ui.ok || !ui.value.activeProjectId || !ui.value.activeThreadId)
				throw new Error('Missing the production delegation owner');
			const scope = {
				projectId: ui.value.activeProjectId,
				threadId: ui.value.activeThreadId,
			};
			const renamed = await desktop.renameThread({
				...scope,
				title: 'metadata boundary fixture',
			});
			if (!renamed.ok) throw new Error(renamed.error.code);
			return scope;
		});
		const profile = await app.evaluate(({app}) => app.getPath('userData'));
		const db = new DatabaseSync(path.join(profile, 'desktop.sqlite'), {
			readOnly: true,
		});
		try {
			const before = db.prepare('SELECT * FROM agent_run ORDER BY id').all();
			await page.evaluate(scope => {
				const state = window as unknown as {
					desktop: import('@/shared/desktop-api').DesktopApi;
					metadataToolId: string | null;
				};
				state.metadataToolId = null;
				const off = state.desktop.onProjectEvent(event => {
					if (event.type !== 'turn' || event.threadId !== scope.threadId)
						return;
					const tool = event.events.find(
						event => event.type === 'tool' && event.delegation,
					);
					if (tool?.type === 'tool') {
						state.metadataToolId = tool.id;
						off();
					}
				});
			}, scope);
			const privatePrompt =
				'fixture failure metadata-boundary-private-user-content';
			await prompt(privatePrompt);
			await expect(page.getByRole('alertdialog')).toHaveCount(1);
			await page
				.getByRole('alertdialog')
				.getByRole('button', {name: 'Allow'})
				.click();
			await expect(
				page.getByText('turn ended: end_turn', {exact: true}),
			).toBeVisible();
			await expect(cards()).toHaveCount(1);
			await expect(cards().last()).toContainText('failed');
			const toolCallId = await page.evaluate(
				() =>
					(window as unknown as {metadataToolId: string | null}).metadataToolId,
			);
			expect(toolCallId).toEqual(expect.any(String));
			const thread = db
				.prepare('SELECT * FROM thread WHERE id=? AND project_id=?')
				.get(scope.threadId, scope.projectId);
			expect(thread?.nanocoder_session_id).toEqual(expect.any(String));
			const execution = db
				.prepare(`SELECT e.*, t.project_id FROM thread_execution_identity e
					JOIN thread t ON t.id=e.thread_id
					WHERE e.thread_id=? AND e.tool_call_id=?`)
				.get(scope.threadId, toolCallId);
			expect(execution).toMatchObject({
				project_id: scope.projectId,
				thread_id: scope.threadId,
				session_id: thread?.nanocoder_session_id,
				outcome: 'failed',
			});
			expect(execution?.id).toMatch(
				/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
			);
			const expected = [
				{
					id: execution?.id,
					thread_id: scope.threadId,
					parent_run_id: null,
					nanocoder_child_id: null,
					role: 'explore',
					status: 'failed',
				},
			];
			const rows = db
				.prepare(`SELECT a.* FROM agent_run a
					JOIN thread_execution_identity e ON e.id=a.id
					JOIN thread_turn_identity turn ON turn.id=e.turn_id
					WHERE a.thread_id=?
					ORDER BY turn.ordinal,e.ordinal`)
				.all(scope.threadId);
			expect(rows).toEqual(expected);
			expect(db.prepare('SELECT * FROM agent_run ORDER BY id').all()).toEqual(
				[...before, ...expected].sort((a, b) =>
					String(a.id).localeCompare(String(b.id)),
				),
			);
			for (const filename of ['desktop.sqlite', 'desktop.sqlite-wal']) {
				const file = path.join(profile, filename);
				if (!existsSync(file)) continue;
				const bytes = readFileSync(file);
				for (const content of [
					privatePrompt,
					'private fixture task',
					'execute_bash fixture (explore)',
					'fixture delegation settled',
					'1.2k tokens',
					'3 tools (read_file)',
				])
					expect(bytes.includes(Buffer.from(content))).toBe(false);
			}
		} finally {
			db.close();
		}
	});
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

test.describe('passive card stop owner', () => {
	test.beforeAll(async () => {
		const result = await build({
			configFile: false,
			logLevel: 'silent',
			define: {'process.env.NODE_ENV': JSON.stringify('production')},
			resolve: {alias: {'@': path.join(root, 'source')}},
			build: {
				write: false,
				minify: false,
				lib: {
					entry: path.join(root, 'e2e/qa/subagent-harness.ts'),
					name: 'subagentFixture',
					formats: ['iife'],
				},
			},
		});
		const outputs = Array.isArray(result) ? result : [result];
		const code = outputs
			.flatMap(output => ('output' in output ? output.output : []))
			.filter(chunk => chunk.type === 'chunk')
			.map(chunk => chunk.code)
			.join('\n');
		if (!code) throw new Error('Missing subagent component fixture');
		await page.evaluate(code);
	});
	test.afterEach(async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.dispose(),
		);
	});

	test('stop captures the clicked owner, not a replacement callback (SUB-04)', async () => {
		await page.evaluate(() => {
			const harness = (window as unknown as HarnessWindow).subagentFixture
				.subagentHarness;
			harness.render('original-owner');
			document
				.querySelector<HTMLButtonElement>('#subagent-stop-fixture button')
				?.click();
			harness.render('replacement-owner');
		});
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						window as unknown as HarnessWindow
					).subagentFixture.subagentHarness.calls(),
				),
			)
			.toEqual(['original-owner']);
	});

	test('two card stops share one pending operation (SUB-04)', async () => {
		await page.evaluate(() => {
			const harness = (window as unknown as HarnessWindow).subagentFixture
				.subagentHarness;
			harness.render('same-owner');
			document
				.querySelectorAll<HTMLButtonElement>('#subagent-stop-fixture button')
				.forEach(button => button.click());
		});
		const buttons = page.locator('#subagent-stop-fixture button');
		await expect(buttons).toHaveCount(2);
		await expect(buttons.first()).toBeDisabled();
		await expect(buttons.last()).toBeDisabled();
		expect(
			await page.evaluate(() =>
				(
					window as unknown as HarnessWindow
				).subagentFixture.subagentHarness.calls(),
			),
		).toEqual(['same-owner']);
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.release(),
		);
		await expect(buttons.first()).toBeEnabled();
	});

	test('failed stop is announced and re-enables the cards (SUB-04)', async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render('failed-owner', true),
		);
		await page.locator('#subagent-stop-fixture button').first().click();
		await expect(
			page.locator('#subagent-stop-fixture').getByRole('alert'),
		).toHaveText('could not stop the turn. try again.');
		await expect(
			page.locator('#subagent-stop-fixture button').first(),
		).toBeEnabled();
	});
});
