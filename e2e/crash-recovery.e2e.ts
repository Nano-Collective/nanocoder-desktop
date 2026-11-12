import {spawnSync} from 'node:child_process';
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
	expect,
	type Page,
	test,
} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

let work: string;
let root: string;
let cli: string;
let app: ElectronApplication | undefined;

const mode = (value: string) =>
	writeFileSync(path.join(root, '.fake-nanocoder'), value);

const launch = async (): Promise<Page> => {
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	const page = await app.firstWindow();
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
	}, root);
	return page;
};

test.beforeEach(() => {
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-crash-')));
	root = path.join(work, 'project');
	cli = path.join(work, 'nanocoder', 'dist', 'cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	mkdirSync(root);
	writeFileSync(
		path.join(work, 'nanocoder', 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', cli);
});

test.afterEach(async () => {
	await app?.close().catch(() => {});
	app = undefined;
	// A killed app can leave its child holding the folder for a moment on Windows.
	rmSync(work, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});

test.setTimeout(90_000);

test('the app killed in the middle of a turn comes back with that thread interrupted, history intact and the next prompt accepted (ACP-17 DATA-02)', async () => {
	mode('wait-for-cancel');
	let page = await launch();
	await page.getByRole('button', {name: 'open a project folder'}).click();
	const input = page.getByRole('textbox', {name: 'message', exact: true});
	await expect(input).toBeEnabled();
	await input.fill('a turn that never finishes');
	await input.press('Enter');
	await expect(page.getByRole('button', {name: 'cancel turn'})).toBeVisible();
	const before = await page.evaluate(async () => {
		const {desktop} = window as unknown as {desktop: DesktopApi};
		const ui = await desktop.getUiState({});
		if (!ui.ok || !ui.value.activeProjectId) throw new Error('fixture scope');
		const list = await desktop.listThreads({
			projectId: ui.value.activeProjectId,
			archiveState: 'active',
		});
		return list.ok ? list.value.map(row => row.runState) : [];
	});
	expect(before).toEqual(['running']);

	// The single-instance lock is held until the killed process has been reaped.
	const killed = app?.process();
	if (!killed) throw new Error('The app has no process');
	const exited = new Promise<void>(resolve =>
		killed.once('exit', () => resolve()),
	);
	// Windows does not reap the children of a killed process, and they keep the profile folder busy.
	if (process.platform === 'win32' && killed.pid)
		spawnSync('taskkill', ['/pid', String(killed.pid), '/T', '/F']);
	else killed.kill('SIGKILL');
	await exited;
	// Closing a Playwright handle for a process that is already gone can wait forever on Linux and Windows.
	app = undefined;

	mode('reported-usage');
	page = await launch();
	const threads = await page.evaluate(async () => {
		const {desktop} = window as unknown as {desktop: DesktopApi};
		const ui = await desktop.getUiState({});
		if (!ui.ok || !ui.value.activeProjectId) throw new Error('fixture scope');
		const list = await desktop.listThreads({
			projectId: ui.value.activeProjectId,
			archiveState: 'active',
		});
		return list.ok
			? list.value.map(row => ({
					runState: row.runState,
					saved: row.nanocoderSessionId !== null,
				}))
			: [];
	});
	expect(threads).toEqual([{runState: 'interrupted', saved: true}]);
	await page.getByRole('button', {name: /interrupted/}).click();

	const next = page.getByRole('textbox', {name: 'message', exact: true});
	await expect(next).toBeEnabled();
	await next.fill('carry on after the crash');
	await next.press('Enter');
	await expect(next).toHaveValue('');
	await expect(page.getByRole('button', {name: /ready/})).toBeVisible();
});
