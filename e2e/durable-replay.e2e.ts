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
import {type ElectronApplication, expect, test} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import {visibleTextContrast} from './qa/ui-contrast';

test('CHAT-08 SUB-05 whole-app restart reuses live execution UUIDs without inventing historical success or duplicate cards', async () => {
	const root = path.resolve(import.meta.dirname, '..');
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-durable-replay-')),
	);
	const project = path.join(work, 'project');
	const profile = path.join(work, 'profile');
	const cli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(project);
	mkdirSync(path.dirname(cli), {recursive: true});
	writeFileSync(path.join(project, '.fake-nanocoder'), 'durable-replay');
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
	const launch = () =>
		electron.launch({
			cwd: root,
			args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
			env: qaEnvironment(process.env, {
				cliPath: cli,
				nodePath: process.execPath,
			}),
		});
	const rows = (threadId: string) => {
		const db = new DatabaseSync(path.join(profile, 'desktop.sqlite'), {
			readOnly: true,
		});
		try {
			return {
				executions: db
					.prepare(`SELECT * FROM thread_execution_identity
					WHERE thread_id=? ORDER BY ordinal`)
					.all(threadId),
				runs: db
					.prepare(`SELECT a.* FROM agent_run a
					JOIN thread_execution_identity e ON e.id=a.id
					WHERE a.thread_id=? ORDER BY e.ordinal`)
					.all(threadId),
			};
		} finally {
			db.close();
		}
	};
	const childPid = (app: ElectronApplication) =>
		app.evaluate((_electron, cli) => {
			const handles = (
				process as unknown as {
					_getActiveHandles(): Array<{pid?: number; spawnargs?: string[]}>;
				}
			)._getActiveHandles();
			return handles.find(handle => handle.spawnargs?.includes(cli))?.pid;
		}, cli);
	let app: ElectronApplication | undefined;
	try {
		app = await launch();
		const firstAppPid = app.process().pid;
		let page = await app.firstWindow();
		expect(page.url()).toMatch(/^app:\/\/renderer\//);
		await app.evaluate(({dialog}, project) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [project],
			})) as typeof dialog.showOpenDialog;
		}, project);
		await page
			.getByRole('button', {
				name: 'open a project folder',
				exact: true,
			})
			.click();
		await expect(
			page.getByRole('textbox', {name: 'message', exact: true}),
		).toBeEnabled();
		const scope = await page.evaluate(async () => {
			const {desktop} = window as unknown as {desktop: DesktopApi};
			const ui = await desktop.getUiState({});
			if (!ui.ok || !ui.value.activeProjectId || !ui.value.activeThreadId)
				throw new Error('Missing the live fixture owner');
			const scope = {
				projectId: ui.value.activeProjectId,
				threadId: ui.value.activeThreadId,
			};
			const renamed = await desktop.renameThread({
				...scope,
				title: 'durable restart fixture',
			});
			if (!renamed.ok) throw new Error(renamed.error.code);
			return scope;
		});
		await page
			.getByRole('textbox', {name: 'message', exact: true})
			.fill('durable fixture private prompt');
		await page.getByRole('button', {name: 'send', exact: true}).click();
		await expect(
			page.getByText('turn ended: end_turn', {exact: true}),
		).toBeVisible();
		await expect(page.locator('.subagent-run-card')).toHaveCount(2);
		const before = rows(scope.threadId);
		expect(before.executions.map(row => row.outcome)).toEqual([
			'failed',
			'unknown',
		]);
		expect(before.runs.map(row => row.status)).toEqual(['failed', 'unknown']);
		const firstChildPid = await childPid(app);
		expect(firstChildPid).toEqual(expect.any(Number));
		if (!firstChildPid) throw new Error('Missing the first fixture child');
		await app.close();
		app = undefined;
		await expect
			.poll(() => {
				try {
					process.kill(firstChildPid, 0);
					return false;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
					return true;
				}
			})
			.toBe(true);

		app = await launch();
		expect(app.process().pid).not.toBe(firstAppPid);
		expect(await app.evaluate(({app}) => app.getPath('userData'))).toBe(
			profile,
		);
		page = await app.firstWindow();
		expect(page.url()).toMatch(/^app:\/\/renderer\//);
		await page
			.locator(`[data-thread-id="${scope.threadId}"] .thread-open`)
			.click();
		const cards = page.locator('.subagent-run-card');
		await expect(cards).toHaveCount(2);
		expect(rows(scope.threadId)).toEqual(before);
		const secondChildPid = await childPid(app);
		expect(secondChildPid).toEqual(expect.any(Number));
		expect(secondChildPid).not.toBe(firstChildPid);
		const failed = cards.filter({hasText: 'known delegation'});
		const unknown = cards.filter({hasText: 'unreported delegation'});
		await expect(failed).toHaveCount(1);
		await expect(unknown).toHaveCount(1);
		await expect(failed.locator('.subagent-state')).toHaveText('✕ failed');
		await expect(unknown.locator('.subagent-state')).toContainText(
			'not reported',
		);
		await expect(unknown.locator('.subagent-state')).not.toContainText('✓');
		await expect(
			cards.getByRole('button', {name: /stop whole turn/}),
		).toHaveCount(0);
		await page.emulateMedia({reducedMotion: 'reduce'});
		for (const theme of ['dark', 'light'] as const) {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			await expect(cards).toHaveCount(2);
			const names = await cards.evaluateAll(elements =>
				elements.map(element => element.getAttribute('aria-label')),
			);
			expect(new Set(names).size).toBe(2);
			const unknownColour = await unknown
				.locator('.subagent-state')
				.evaluate(element => {
					const card = element.closest('.subagent-run-card');
					if (!card) throw new Error('Missing the historical card');
					return {
						state: getComputedStyle(element).color,
						card: getComputedStyle(card).color,
					};
				});
			expect(unknownColour.state).toBe(unknownColour.card);
			expect(
				await failed
					.locator('.subagent-state')
					.evaluate(element => getComputedStyle(element).color),
			).not.toBe(unknownColour.state);
			expect(await visibleTextContrast(page, theme)).toEqual([]);
		}
		const diagnostics = await page.evaluate(async scope => {
			return (
				window as unknown as {desktop: DesktopApi}
			).desktop.getDiagnostics({
				projectId: scope.projectId,
			});
		}, scope);
		if (!diagnostics.ok) throw new Error(diagnostics.error.code);
		expect(diagnostics.value.lines).toContain('{"method":"session/resume"}');
		expect(diagnostics.value.lines).not.toContain('{"method":"session/new"}');
		expect(diagnostics.value.lines).not.toContain('{"method":"session/load"}');
	} finally {
		await app?.close();
		rmSync(work, {recursive: true, force: true});
	}
});
