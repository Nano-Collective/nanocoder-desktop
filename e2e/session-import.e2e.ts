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
import {expect, test} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import {openFolderFromPalette} from './qa/open-folder';
import {turnEnded} from './qa/turn-state';
import {visibleTextContrast} from './qa/ui-contrast';

for (const theme of ['dark', 'light'] as const) {
	test(`ACP-18 ${theme} keyboard import remains metadata-only until an explicit same-session open`, async () => {
		const root = path.resolve(import.meta.dirname, '..');
		const work = realpathSync.native(
			mkdtempSync(path.join(tmpdir(), 'nd-session-import-')),
		);
		const project = path.join(work, 'project-a');
		const second = path.join(work, 'project-b');
		const cli = path.join(work, 'nanocoder/dist/cli.js');
		for (const folder of [project, second]) {
			mkdirSync(folder);
			writeFileSync(path.join(folder, '.fake-nanocoder'), 'session-discovery');
		}
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
		const app = await electron.launch({
			cwd: root,
			args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
			env: qaEnvironment(process.env, {
				cliPath: cli,
				nodePath: process.execPath,
			}),
		});
		try {
			const page = await app.firstWindow();
			expect(page.url()).toMatch(/^app:\/\/renderer\//);
			await page.emulateMedia({reducedMotion: 'reduce'});
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			const open = async (folder: string) => {
				await app.evaluate(({dialog}, folder) => {
					dialog.showOpenDialog = (async () => ({
						canceled: false,
						filePaths: [folder],
					})) as typeof dialog.showOpenDialog;
				}, folder);
				await openFolderFromPalette(page, folder);
				await expect(
					page.getByRole('textbox', {name: 'message', exact: true}),
				).toBeEnabled();
			};
			const snapshot = () =>
				test.step(
					'read native thread and diagnostic state',
					() =>
						page.evaluate(async () => {
							const {desktop} = window as unknown as {desktop: DesktopApi};
							const ui = await desktop.getUiState({});
							if (!ui.ok || !ui.value.activeProjectId)
								throw new Error('Missing project');
							const projectId = ui.value.activeProjectId;
							const rows = await desktop.listThreads({
								projectId,
								archiveState: 'active',
							});
							const diagnostics = await desktop.getDiagnostics({projectId});
							if (!rows.ok) throw new Error(`listThreads: ${rows.error.code}`);
							if (!diagnostics.ok)
								throw new Error(`getDiagnostics: ${diagnostics.error.code}`);
							const methods = diagnostics.value.lines.flatMap(line => {
								try {
									const {method} = JSON.parse(line) as {method?: string};
									return method ? [method] : [];
								} catch {
									return [];
								}
							});
							return {ui: ui.value, rows: rows.value, methods};
						}),
					{timeout: 5_000},
				);
			await open(project);
			const imports = page.getByRole('region', {
				name: 'import saved sessions',
				exact: true,
			});
			const importButton = imports.getByRole('button', {
				name: 'import saved session: <script>saved fixture</script>',
				exact: true,
			});
			await expect(importButton).toBeEnabled();
			await expect(imports.locator('script')).toHaveCount(0);
			await expect(imports.locator('time')).toHaveAttribute(
				'datetime',
				'2026-10-29T12:00:00.000Z',
			);
			expect(await visibleTextContrast(page, theme)).toEqual([]);
			const input = page.getByRole('textbox', {name: 'message', exact: true});
			await input.fill('retained unqueued import draft');
			const before = await snapshot();
			const refresh = imports.getByRole('button', {
				name: 'refresh saved sessions',
				exact: true,
			});
			await refresh.focus();
			await page.keyboard.press('Tab');
			await expect(importButton).toBeFocused();
			expect(
				await importButton.evaluate(button => ({
					native: button instanceof HTMLButtonElement,
					keyboard: button.matches(':focus-visible'),
					outline: getComputedStyle(button).outlineWidth,
				})),
			).toEqual({native: true, keyboard: true, outline: '2px'});
			await page.keyboard.press('Enter');
			await expect(importButton).toHaveCount(0);
			await expect(refresh).toBeFocused();
			await expect(input).toHaveValue('retained unqueued import draft');
			const after = await snapshot();
			expect(after.ui).toEqual(before.ui);
			expect(after.rows).toHaveLength(before.rows.length + 1);
			const imported = after.rows.find(
				row => row.nanocoderSessionId === 'discovered-session',
			);
			const title = ['<script>', 'saved fixture', '</script>'].join('');
			expect(imported).toMatchObject({
				projectId: before.ui.activeProjectId,
				title,
				archiveState: 'active',
				runState: 'ready',
				mode: 'normal',
				sessionCwd: project,
				lastActivityAt: '2026-10-29T12:00:00.000Z',
			});
			expect(after.methods).toEqual(before.methods);
			await refresh.press('Enter');
			await expect(refresh).toBeEnabled();
			await expect(importButton).toHaveCount(0);
			const refreshed = await snapshot();
			for (const method of [
				'session/new',
				'session/load',
				'session/resume',
				'session/set_mode',
				'session/prompt',
			]) {
				expect(refreshed.methods.filter(row => row === method)).toEqual(
					before.methods.filter(row => row === method),
				);
			}
			if (!imported) throw new Error('Missing imported thread');
			await test.step(
				'explicitly open the imported thread',
				async () => {
					await page
						.getByRole('button', {
							name: '<script>saved fixture</script> · ready',
							exact: true,
						})
						.click({timeout: 5_000});
					await expect(
						page.getByText('Earlier question', {exact: true}),
					).toBeVisible();
					await expect(input).toBeEnabled();
					await expect(input).toHaveValue('');
				},
				{timeout: 5_000},
			);
			const opened = await snapshot();
			expect(opened.ui.activeThreadId).toBe(imported.id);
			for (const method of ['session/resume', 'session/set_mode']) {
				expect(opened.methods.filter(row => row === method)).toHaveLength(
					before.methods.filter(row => row === method).length + 1,
				);
			}
			expect(opened.methods).not.toContain('session/load');
			expect(
				opened.methods.filter(row => row === 'session/prompt'),
			).toHaveLength(0);
			await input.fill('explicit imported follow-up');
			await input.press('Enter');
			await expect(turnEnded(page)).toBeVisible();
			expect(
				(await snapshot()).methods.filter(row => row === 'session/prompt'),
			).toHaveLength(1);
			await open(second);
			await expect(
				page.getByText('<script>saved fixture</script>', {exact: true}),
			).toHaveCount(0);
			await expect(
				page.getByRole('region', {name: 'import saved sessions'}),
			).toContainText('no sessions offered for import');
			expect((await snapshot()).ui.activeProjectId).not.toBe(
				before.ui.activeProjectId,
			);
			expect(
				await app.evaluate(({BrowserWindow}) =>
					BrowserWindow.getAllWindows().some(window => window.isVisible()),
				),
			).toBe(false);
		} finally {
			await test.step('close the hidden app', () => app.close(), {
				timeout: 5_000,
			});
			rmSync(work, {recursive: true, force: true});
		}
	});
}
