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
import type {BrowserRequests, BrowserSnapshot} from '@/shared/browser';
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult} from '@/shared/ipc';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

const probe = `<!doctype html><title>pending</title><script>
document.title = JSON.stringify({
	desktop: typeof window.desktop,
	require: typeof require,
	process: typeof process,
	ipcRenderer: typeof window.ipcRenderer,
	electron: typeof window.electron,
});
</script>`;

let work: string;
let app: ElectronApplication;
let page: Page;
let projectId: string;
let server: Server;
let origin: string;

function call<K extends keyof BrowserRequests>(
	key: K,
	request: BrowserRequests[K],
): Promise<IpcResult<BrowserSnapshot | null>> {
	return page.evaluate(
		({key, request}) => {
			const api = (window as unknown as {desktop: DesktopApi}).desktop.browser;
			return (
				api[key] as (
					request: unknown,
				) => Promise<IpcResult<BrowserSnapshot | null>>
			)(request);
		},
		{key, request},
	);
}

test.beforeEach(async () => {
	server = createServer((request, response) => {
		if (request.url === '/redirect') {
			response.writeHead(302, {Location: 'http://example.com/'});
			response.end();
			return;
		}
		response.writeHead(200, {'Content-Type': 'text/html'});
		response.end(probe);
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-browser-')));
	mkdirSync(path.join(work, 'project'));
	mkdirSync(path.join(work, 'nanocoder/dist'), {recursive: true});
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
		path.resolve(
			import.meta.dirname,
			'../source/main/nanocoder/fixtures/fake-nanocoder.mjs',
		),
		path.join(work, 'nanocoder/dist/cli.js'),
	);
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {
			cliPath: path.join(work, 'nanocoder/dist/cli.js'),
			nodePath: process.execPath,
		}),
	});
	page = await app.firstWindow();
	await app.evaluate(
		({dialog}, root) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [root],
			})) as typeof dialog.showOpenDialog;
		},
		path.join(work, 'project'),
	);
	const added = await page.evaluate(() =>
		(window as unknown as {desktop: DesktopApi}).desktop.addProject({}),
	);
	if (!added.ok || added.value.status !== 'selected')
		throw new Error('Project was not added');
	projectId = added.value.project.id;
	const opened = await page.evaluate(
		projectId =>
			(window as unknown as {desktop: DesktopApi}).desktop.openProject({
				projectId,
			}),
		projectId,
	);
	expect(opened).toMatchObject({ok: true, value: {status: 'opened'}});
});

test.afterEach(async () => {
	await app.close().catch(() => {});
	await new Promise<void>(resolve => server.close(() => resolve()));
	rmSync(work, {recursive: true, force: true});
});

test('SEC-12 a test page cannot reach any desktop API', async () => {
	const opened = await call('open', {projectId, url: `${origin}/`});
	expect(opened).toMatchObject({ok: true, value: {status: 'ready'}});
	const title = await app.evaluate(({webContents}, prefix) => {
		const contents = webContents
			.getAllWebContents()
			.find(candidate => candidate.getURL().startsWith(prefix));
		return contents?.getTitle() ?? null;
	}, origin);
	expect(title).not.toBeNull();
	expect(JSON.parse(title as string)).toEqual({
		desktop: 'undefined',
		require: 'undefined',
		process: 'undefined',
		ipcRenderer: 'undefined',
		electron: 'undefined',
	});
});

test('BRW-01/BRW-05 browser data is stored apart from the app and per project', async () => {
	await call('open', {projectId, url: `${origin}/`});
	const storage = await app.evaluate(({session, webContents}, prefix) => {
		const contents = webContents
			.getAllWebContents()
			.find(candidate => candidate.getURL().startsWith(prefix));
		return {
			browser: contents?.session.storagePath ?? null,
			app: session.defaultSession.storagePath ?? null,
		};
	}, origin);
	expect(storage.browser).toContain(`browser-${projectId}`);
	expect(storage.browser).not.toBe(storage.app);
	expect(storage.browser).toContain(`${path.sep}Partitions${path.sep}`);
	expect(storage.app).not.toContain(`${path.sep}Partitions${path.sep}`);
});

test('BRW-03 a public address is refused and no view appears', async () => {
	const refused = await call('open', {
		projectId,
		url: 'https://example.com/',
	});
	expect(refused).toMatchObject({ok: false, error: {code: 'DENIED'}});
	const views = await app.evaluate(
		({webContents}) =>
			webContents
				.getAllWebContents()
				.filter(contents => contents.getURL().startsWith('https://')).length,
	);
	expect(views).toBe(0);
});

test('BRW-03 a redirect from localhost to a public site stops', async () => {
	const result = await call('open', {projectId, url: `${origin}/redirect`});
	expect(result).toMatchObject({ok: false});
	const urls = await app.evaluate(({webContents}) =>
		webContents.getAllWebContents().map(contents => contents.getURL()),
	);
	expect(urls.some(url => url.includes('example.com'))).toBe(false);
});

test('BRW-01 closing the view removes it', async () => {
	await call('open', {projectId, url: `${origin}/`});
	const closed = await call('close', {projectId});
	expect(closed).toMatchObject({ok: true, value: {status: 'closed'}});
	const remaining = await app.evaluate(
		({webContents}, prefix) =>
			webContents
				.getAllWebContents()
				.filter(contents => contents.getURL().startsWith(prefix)).length,
		origin,
	);
	expect(remaining).toBe(0);
});
