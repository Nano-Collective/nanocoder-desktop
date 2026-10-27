import {
	copyFileSync,
	existsSync,
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

const work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-e2e-')));
const fakeCli = path.join(work, 'nanocoder', 'dist', 'cli.js');
let app: ElectronApplication;
let page: Page;

function project(name: string, mode?: string): string {
	const dir = path.join(work, name);
	mkdirSync(dir);
	if (mode) writeFileSync(path.join(dir, '.fake-nanocoder'), mode);
	return dir;
}

interface Prompt {
	title?: string;
	message?: string;
	detail?: string;
}

// Stubs both native dialogs: the folder picker, and the trust prompt with the given button.
async function openFolder(folder: string, trustButton = 1): Promise<void> {
	await app.evaluate(
		({dialog}, [picked, button]) => {
			const state = globalThis as {trustPrompts?: unknown[]};
			state.trustPrompts = [];
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [picked],
			})) as typeof dialog.showOpenDialog;
			dialog.showMessageBox = (async (...args: unknown[]) => {
				state.trustPrompts?.push(args.at(-1));
				return {response: button, checkboxChecked: false};
			}) as typeof dialog.showMessageBox;
		},
		[folder, trustButton] as const,
	);
	await page.getByRole('button', {name: 'Open a project folder'}).click();
	await expect(
		page.getByRole('button', {name: 'Open a project folder'}),
	).toBeEnabled();
}

const trustPrompts = () =>
	app.evaluate(
		() => (globalThis as {trustPrompts?: Prompt[]}).trustPrompts ?? [],
	);

test.beforeAll(async () => {
	mkdirSync(path.dirname(fakeCli), {recursive: true});
	writeFileSync(
		path.join(work, 'nanocoder', 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', fakeCli);
	app = await electron.launch({
		args: ['.'],
		env: {
			...process.env,
			NANOCODER_DESKTOP_CLI: fakeCli,
			NANOCODER_DESKTOP_NODE: process.execPath,
		},
	});
	page = await app.firstWindow();
});

test.afterAll(async () => {
	await app.close();
	rmSync(work, {recursive: true, force: true});
});

test('shows the Nanocoder it will launch', async () => {
	await expect(page.getByText(`Nanocoder 9.9.9 at ${fakeCli}`)).toBeVisible();
});

test('opens a trusted folder in normal mode without asking', async () => {
	const root = project('trusted');
	await openFolder(root);
	const agent = page.getByRole('region', {name: 'Connected agent'});
	await expect(agent).toContainText(
		`Connected to nanocoder 9.9.9 over ACP protocol version 1 in ${root}`,
	);
	await expect(agent).toContainText('Session fake-session in normal mode');
	await expect(agent.locator('dt:has-text("Resume sessions") + dd')).toHaveText(
		'yes',
	);
	expect(await trustPrompts()).toEqual([]);
});

test("asks with Nanocoder's reason, and shows its message when the user says no", async () => {
	const root = project('refused', 'untrusted');
	await openFolder(root);
	const [prompt] = await trustPrompts();
	expect(prompt.title).toBe('Trust this folder?');
	// The home folder is redacted to ~, and on Windows the temp folder sits inside it.
	expect(prompt.message).toMatch(/^Directory /);
	expect(prompt.message).toContain(
		`${path.sep}${path.basename(root)} is not trusted.`,
	);
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('Not opened. Directory');
	await expect(alert).toContainText('is not trusted.');
	await expect(alert).not.toContainText('--trust-directory');
	await expect(alert).not.toContainText('NANOCODER_TRUST_DIRECTORY');
	expect(existsSync(path.join(root, '.fake-trusted'))).toBe(false);
});

test('trusts the folder through Nanocoder when the user agrees, then opens it', async () => {
	const root = project('accepted', 'untrusted');
	await openFolder(root, 0);
	expect(await trustPrompts()).toHaveLength(1);
	expect(existsSync(path.join(root, '.fake-trusted'))).toBe(true);
	await expect(
		page.getByRole('region', {name: 'Connected agent'}),
	).toContainText('Session fake-session in normal mode');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('reports a second refusal without asking again', async () => {
	await openFolder(project('stubborn', 'refuse'), 0);
	expect(await trustPrompts()).toHaveLength(1);
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('is not trusted');
	await expect(alert).not.toContainText('unrelated warning');
});
