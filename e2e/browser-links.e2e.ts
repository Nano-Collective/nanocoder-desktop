import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
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

const root = path.resolve(import.meta.dirname, '..');
let work: string;
let app: ElectronApplication;
let page: Page;
let server: Server;
let origin: string;
let host: string;

test.beforeEach(async () => {
	server = createServer((request, response) => {
		response.writeHead(200, {'Content-Type': 'text/html'});
		response.end('<!doctype html><title>A page</title>a page');
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as AddressInfo).port;
	origin = `http://127.0.0.1:${port}`;
	host = `127.0.0.1:${port}`;
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-links-')));
	const project = path.join(work, 'project');
	mkdirSync(project);
	writeFileSync(path.join(project, '.fake-nanocoder'), 'files');
	const home = path.join(work, 'home');
	mkdirSync(home);
	for (const profile of ['.zshrc', '.bash_profile', '.bashrc']) {
		writeFileSync(
			path.join(home, profile),
			"PS1='$ '\nPROMPT='$ '\nHISTFILE=/dev/null\n",
		);
	}
	const fakeCli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(path.dirname(fakeCli), {recursive: true});
	writeFileSync(
		path.join(work, 'nanocoder/package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync(
		path.join(root, 'source/main/nanocoder/fixtures/fake-nanocoder.mjs'),
		fakeCli,
	);
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(
			{...process.env, HOME: home},
			{cliPath: fakeCli, nodePath: process.execPath},
		),
	});
	page = await app.firstWindow();
	await page.setViewportSize({width: 1240, height: 900});
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (async () => ({
			response: 0,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
	}, project);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
});

test.afterEach(async () => {
	try {
		await app?.close();
	} finally {
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
		rmSync(work, {recursive: true, force: true});
	}
});

const composer = () =>
	page.getByRole('textbox', {name: 'message', exact: true});

async function browserUrl(): Promise<string | null> {
	return page.evaluate(async () => {
		const desktop = (window as unknown as {desktop: DesktopApi}).desktop;
		const projects = await desktop.listProjects({});
		if (!projects.ok) return null;
		const snapshot = await desktop.browser.get({
			projectId: projects.value[0].id,
		});
		return snapshot.ok && snapshot.value.status === 'ready'
			? snapshot.value.url
			: null;
	});
}

async function startServerInTerminal() {
	await page.getByRole('button', {name: 'open terminal', exact: true}).click();
	await page.getByRole('button', {name: 'start terminal'}).click();
	await expect(
		page.getByRole('status').filter({hasText: 'running'}),
	).toBeVisible();
	await page.locator('.xterm-helper-textarea').focus();
	await page.keyboard.type(`echo "Local: ${origin}/dev"`);
	await page.keyboard.press('Enter');
	// The typed command shows the address as it is typed; once it appears twice, the output is in.
	const line = `Local: ${origin}/dev`;
	await expect
		.poll(
			async () =>
				(await page.locator('.xterm-rows').innerText()).split(line).length - 1,
		)
		.toBeGreaterThanOrEqual(2);
}

test('TERM-05 starting a dev server and opening its address takes one action', async () => {
	await startServerInTerminal();
	const open = page.getByRole('button', {name: `open ${host} in the browser`});
	await expect(open).toBeVisible();
	await open.click();
	await expect(page.getByRole('textbox', {name: 'address'})).toHaveValue(
		`${origin}/dev`,
	);
	await expect.poll(browserUrl).toBe(`${origin}/dev`);
});

test('TERM-05 the address in the terminal output is itself a link that opens the browser', async () => {
	await startServerInTerminal();
	await expect(
		page.getByRole('button', {name: `open ${host} in the browser`}),
	).toBeVisible();
	const link = page
		.locator('.xterm-rows')
		.getByText(`${origin}/dev`, {exact: false})
		.last();
	await expect(link).toBeVisible();
	await expect.poll(async () => (await link.boundingBox()) !== null).toBe(true);
	const box = await link.boundingBox();
	if (!box) throw new Error('The terminal address has no box');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x - 4, y);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.up();
	await expect.poll(browserUrl).toBe(`${origin}/dev`);
});

test('BRW-10 TERM-05 the page url and title reach the next prompt, and a localhost link in the answer opens the browser', async () => {
	await page.getByRole('button', {name: 'open browser', exact: true}).click();
	await page.getByRole('textbox', {name: 'address'}).fill(`${origin}/a`);
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await expect.poll(browserUrl).toBe(`${origin}/a`);
	await page.getByRole('button', {name: 'send page to chat'}).click();
	const chips = page.getByRole('list', {name: 'attached to your next message'});
	await expect(chips.getByText(`page ${host}`)).toBeVisible();
	await composer().fill('what is on this page?');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect(page.getByText('files fixture done')).toBeVisible();
	const answer = page.locator('.stream-markdown').filter({
		hasText: 'Title: A page',
	});
	await expect(answer).toContainText('page data');
	await expect(answer).toContainText(`URL: ${origin}/a`);
	await expect(page.getByText(`browser page: ${host}`)).toBeVisible();
	await expect(chips).toHaveCount(0);
	await page.getByRole('button', {name: 'close panel'}).click();
	await page
		.getByRole('button', {name: new RegExp(`${host.replace('.', '\\.')}`)})
		.first()
		.click();
	await expect(page.getByRole('textbox', {name: 'address'})).toBeVisible();
	await expect.poll(browserUrl).toBe(`${origin}/a`);
});

test('BRW-10 a page that changed after it was attached is refused with a reason', async () => {
	await page.getByRole('button', {name: 'open browser', exact: true}).click();
	await page.getByRole('textbox', {name: 'address'}).fill(`${origin}/a`);
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await expect.poll(browserUrl).toBe(`${origin}/a`);
	await page.getByRole('button', {name: 'send page to chat'}).click();
	await page.getByRole('textbox', {name: 'address'}).fill(`${origin}/b`);
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await expect.poll(browserUrl).toBe(`${origin}/b`);
	await composer().fill('look');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect(
		page.getByText(/the page changed, so send it again/),
	).toBeVisible();
	await expect(page.getByText('files fixture done')).toHaveCount(0);
});
