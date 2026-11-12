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
	expect,
	type Page,
	test,
} from '@playwright/test';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

let work: string;
let root: string;
let cli: string;
let app: ElectronApplication | undefined;

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

const changeDatabase = (sql: string) => {
	const database = new DatabaseSync(
		path.join(work, 'profile', 'desktop.sqlite'),
	);
	try {
		database.exec(sql);
	} finally {
		database.close();
	}
};

test.beforeEach(() => {
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-retention-')));
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
	copyFileSync(
		'source/main/nanocoder/fixtures/fake-control-nanocoder.mjs',
		cli,
	);
});

test.afterEach(async () => {
	await app?.close();
	app = undefined;
	rmSync(work, {recursive: true, force: true});
});

test('a chat Nanocoder may delete soon says so in the thread list and is announced once, and a pinned chat does not (CHAT-23 DEC-45)', async () => {
	let page = await launch();
	await page.getByRole('button', {name: 'open a project folder'}).click();
	const input = page.getByRole('textbox', {name: 'message', exact: true});
	await expect(input).toBeEnabled();
	await input.fill('a chat to age');
	await input.press('Enter');
	await expect(input).toHaveValue('');
	await expect(page.locator('.thread-retention')).toHaveCount(0);
	await app?.close();

	const aged = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
	changeDatabase(`UPDATE thread SET last_activity_at = '${aged}'`);
	page = await launch();
	await expect(page.locator('.thread-retention')).toHaveText(
		'deleted in 1 day',
	);
	await expect(
		page.getByRole('button', {name: /a chat to age.*deleted in 1 day/}),
	).toBeVisible();
	await expect(
		page.getByText('1 chat may be deleted by Nanocoder soon'),
	).toBeVisible();
	await expect(page.locator('.thread-open').first()).toHaveAttribute(
		'title',
		/Open the chat to keep it/,
	);
	await app?.close();

	changeDatabase('UPDATE thread SET session_pinned = 1');
	page = await launch();
	await expect(page.locator('.thread-open')).toHaveCount(1);
	await expect(page.locator('.thread-retention')).toHaveCount(0);
});
