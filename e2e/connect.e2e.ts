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

async function openFolder(folder: string): Promise<void> {
	await app.evaluate(({dialog}, picked) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [picked],
		})) as typeof dialog.showOpenDialog;
	}, folder);
	await page.getByRole('button', {name: 'Open a project folder'}).click();
}

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

test('connects in the chosen folder and records what Nanocoder offers', async () => {
	const root = project('trusted');
	await openFolder(root);
	const agent = page.getByRole('region', {name: 'Connected agent'});
	await expect(agent).toContainText(
		`Connected to nanocoder 9.9.9 over ACP protocol version 1 in ${root}`,
	);
	await expect(agent.locator('dt:has-text("Resume sessions") + dd')).toHaveText(
		'yes',
	);
});

test("shows Nanocoder's own message for a folder it refuses", async () => {
	await openFolder(project('untrusted', 'refuse'));
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('is not trusted');
	await expect(alert).toContainText('Pass --trust-directory');
	await expect(alert).not.toContainText('unrelated warning');
});
