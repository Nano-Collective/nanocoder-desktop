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
let port: number;

const PUBLIC_HOST = 'public-site.test';
const publicUrl = (suffix = '/') => `http://${PUBLIC_HOST}:${port}${suffix}`;

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
		if (request.url === '/slow') return;
		if (request.url === '/redirect') {
			response.writeHead(302, {Location: publicUrl('/landing')});
			response.end();
			return;
		}
		response.writeHead(200, {'Content-Type': 'text/html'});
		response.end(probe);
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
	origin = `http://127.0.0.1:${port}`;
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
		args: [
			'.',
			`--user-data-dir=${path.join(work, 'profile')}`,
			`--host-resolver-rules=MAP ${PUBLIC_HOST} 127.0.0.1`,
		],
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
	server.closeAllConnections();
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

async function publicBrowsing(enabled: boolean) {
	const saved = await page.evaluate(
		enabled =>
			(window as unknown as {desktop: DesktopApi}).desktop.updateSettings({
				patch: {publicBrowsingEnabled: enabled},
			}),
		enabled,
	);
	expect(saved).toMatchObject({ok: true});
}

const pageHosts = () =>
	app.evaluate(({webContents}) =>
		webContents.getAllWebContents().map(contents => {
			try {
				return new URL(contents.getURL()).hostname;
			} catch {
				return '';
			}
		}),
	);

test('BRW-03 a redirect from localhost to a public site stops and is reported while public browsing is off', async () => {
	const result = await call('open', {projectId, url: `${origin}/redirect`});
	expect(result).toMatchObject({ok: false, error: {code: 'DENIED'}});
	const snapshot = await call('get', {projectId});
	expect(snapshot).toMatchObject({
		ok: true,
		value: {
			status: 'failed',
			blocked: {reason: 'public-off', url: publicUrl('/landing')},
		},
	});
	expect(await pageHosts()).not.toContain(PUBLIC_HOST);
});

test('BRW-03 the same redirect is followed once public browsing is on', async () => {
	await publicBrowsing(true);
	const result = await call('open', {projectId, url: `${origin}/redirect`});
	expect(result).toMatchObject({
		ok: true,
		value: {
			status: 'ready',
			origin: `http://${PUBLIC_HOST}:${port}`,
			security: 'insecure',
			blocked: null,
		},
	});
});

test('BRW-03 a public address is refused until the setting is on', async () => {
	const refused = await call('open', {projectId, url: publicUrl('/a')});
	expect(refused).toMatchObject({ok: false, error: {code: 'DENIED'}});
	await publicBrowsing(true);
	const opened = await call('open', {projectId, url: publicUrl('/a')});
	expect(opened).toMatchObject({ok: true, value: {status: 'ready'}});
});

test('BRW-02 back, forward and reload move through the pages that were opened', async () => {
	await call('open', {projectId, url: `${origin}/a`});
	await call('open', {projectId, url: `${origin}/b`});
	await call('navigate', {projectId, action: 'back'});
	await expect
		.poll(async () => {
			const result = await call('get', {projectId});
			return result.ok ? result.value?.url : null;
		})
		.toBe(`${origin}/a`);
	const back = await call('get', {projectId});
	expect(back).toMatchObject({
		ok: true,
		value: {canGoForward: true, canGoBack: false},
	});
	await call('navigate', {projectId, action: 'forward'});
	await expect
		.poll(async () => {
			const result = await call('get', {projectId});
			return result.ok ? result.value?.url : null;
		})
		.toBe(`${origin}/b`);
	expect(await call('navigate', {projectId, action: 'reload'})).toMatchObject({
		ok: true,
	});
});

const viewBounds = () =>
	app.evaluate(({BrowserWindow}) => {
		const window = BrowserWindow.getAllWindows()[0];
		const view = window.contentView.children[0] as
			| {getBounds(): Electron.Rectangle; getVisible(): boolean}
			| undefined;
		return view ? {...view.getBounds(), visible: view.getVisible()} : null;
	});

async function openBrowserTab() {
	await page.getByRole('button', {name: 'open browser', exact: true}).click();
	await expect(page.getByRole('textbox', {name: 'address'})).toBeVisible();
}

test('BRW-02/BRW-04 the address bar opens a page and shows its origin and security', async () => {
	await openBrowserTab();
	await page
		.getByRole('textbox', {name: 'address'})
		.fill(`127.0.0.1:${port}/a`);
	await page.getByRole('button', {name: 'go', exact: true}).click();
	const status = page.getByRole('status').filter({hasText: 'local'});
	await expect(status).toContainText(origin);
	await expect(page.getByRole('button', {name: 'reload'})).toBeEnabled();
});

test('BRW-03 a public address in the bar stops, asks, and opens after the user turns the setting on', async () => {
	await openBrowserTab();
	await page.getByRole('textbox', {name: 'address'}).fill(publicUrl('/a'));
	await page.getByRole('button', {name: 'go', exact: true}).click();
	const notice = page.getByRole('alert').filter({hasText: 'public site'});
	await expect(notice).toContainText(`${PUBLIC_HOST}:${port}`);
	expect(await viewBounds()).toBeNull();
	await notice
		.getByRole('button', {name: 'turn on public sites and open it'})
		.click();
	await expect(
		page.getByRole('checkbox', {name: 'allow public sites'}),
	).toBeChecked();
	await expect(
		page.getByRole('status').filter({hasText: 'not secure'}),
	).toContainText(`${PUBLIC_HOST}:${port}`);
});

test('BRW-03 staying on localhost dismisses the question and keeps the setting off', async () => {
	await openBrowserTab();
	await page.getByRole('textbox', {name: 'address'}).fill(publicUrl('/a'));
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await page.getByRole('button', {name: 'stay on localhost'}).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(
		page.getByRole('checkbox', {name: 'allow public sites'}),
	).not.toBeChecked();
});

for (const width of [1240, 1020, 840]) {
	test(`BRW-01 the native view follows the panel at ${width}px`, async () => {
		await app.evaluate(({BrowserWindow}, size) => {
			BrowserWindow.getAllWindows()[0].setContentSize(size, 800);
		}, width);
		await openBrowserTab();
		await page
			.getByRole('textbox', {name: 'address'})
			.fill(`127.0.0.1:${port}/a`);
		await page.getByRole('button', {name: 'go', exact: true}).click();
		await expect(
			page.getByRole('status').filter({hasText: 'local'}),
		).toBeVisible();
		const region = page.getByRole('region', {name: 'web page'});
		await expect
			.poll(async () => {
				const box = await region.boundingBox();
				const view = await viewBounds();
				return box && view
					? {
							x: view.x,
							y: view.y,
							width: view.width,
							height: view.height,
							visible: view.visible,
							expected: {
								x: Math.round(box.x),
								y: Math.round(box.y),
								width: Math.round(box.width),
								height: Math.round(box.height),
							},
						}
					: null;
			})
			.toMatchObject({visible: true});
		const box = await region.boundingBox();
		const view = await viewBounds();
		expect(view).toMatchObject({
			x: Math.round(box?.x ?? -1),
			y: Math.round(box?.y ?? -1),
			width: Math.round(box?.width ?? -1),
			height: Math.round(box?.height ?? -1),
		});
	});
}

test('BRW-01 the native view steps aside for an open dialog and returns after it closes', async () => {
	await openBrowserTab();
	await page
		.getByRole('textbox', {name: 'address'})
		.fill(`127.0.0.1:${port}/a`);
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await expect.poll(async () => (await viewBounds())?.visible).toBe(true);
	await page.evaluate(() => {
		const dialog = document.createElement('dialog');
		dialog.id = 'test-modal';
		dialog.textContent = 'modal';
		document.body.appendChild(dialog);
		dialog.showModal();
	});
	await expect.poll(async () => (await viewBounds())?.visible).toBe(false);
	await page.evaluate(() => {
		(document.getElementById('test-modal') as HTMLDialogElement).close();
	});
	await expect.poll(async () => (await viewBounds())?.visible).toBe(true);
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

const loadingStatus = async () => {
	const result = await call('get', {projectId});
	return result.ok ? result.value?.status : null;
};

test('BRW-02 stop cancels a slow load and keeps the page that was showing', async () => {
	await call('open', {projectId, url: `${origin}/a`});
	const slow = call('open', {projectId, url: `${origin}/slow`});
	await expect.poll(loadingStatus).toBe('loading');
	await call('navigate', {projectId, action: 'stop'});
	expect(await slow).toMatchObject({
		ok: true,
		value: {status: 'ready', url: `${origin}/a`, reason: null},
	});
});

test('BRW-02 a second address supersedes a slow load and loads without being reported as failed', async () => {
	const slow = call('open', {projectId, url: `${origin}/slow`});
	await expect.poll(loadingStatus).toBe('loading');
	const fast = await call('open', {projectId, url: `${origin}/b`});
	expect(fast).toMatchObject({
		ok: true,
		value: {status: 'ready', url: `${origin}/b`},
	});
	expect(await slow).toMatchObject({ok: false, error: {code: 'DENIED'}});
	expect(await call('get', {projectId})).toMatchObject({
		ok: true,
		value: {status: 'ready', url: `${origin}/b`, reason: null},
	});
});

test('BRW-03 a refused address entered again after staying on localhost asks again', async () => {
	await openBrowserTab();
	const address = page.getByRole('textbox', {name: 'address'});
	await address.fill(publicUrl('/a'));
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await page.getByRole('button', {name: 'stay on localhost'}).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await address.fill(publicUrl('/a'));
	await page.getByRole('button', {name: 'go', exact: true}).click();
	await expect(
		page.getByRole('alert').filter({hasText: 'public site'}),
	).toBeVisible();
});

test('BRW-01 after switching project with the browser tab open the next page is placed and visible', async () => {
	await openBrowserTab();
	const second = path.join(work, 'project-two');
	mkdirSync(second);
	await app.evaluate(({dialog}, root) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [root],
		})) as typeof dialog.showOpenDialog;
	}, second);
	const next = await page.evaluate(async () => {
		const desktop = (window as unknown as {desktop: DesktopApi}).desktop;
		const added = await desktop.addProject({});
		if (!added.ok || added.value.status !== 'selected') return null;
		const opened = await desktop.openProject({
			projectId: added.value.project.id,
		});
		return opened.ok ? added.value.project.id : null;
	});
	expect(next).not.toBeNull();
	const result = await call('open', {
		projectId: next as string,
		url: `${origin}/a`,
	});
	expect(result).toMatchObject({ok: true, value: {status: 'ready'}});
	const region = page.getByRole('region', {name: 'web page'});
	await expect
		.poll(async () => {
			const box = await region.boundingBox();
			const view = await viewBounds();
			return box && view
				? view.visible &&
						view.x === Math.round(box.x) &&
						view.y === Math.round(box.y) &&
						view.width === Math.round(box.width) &&
						view.height === Math.round(box.height)
				: false;
		})
		.toBe(true);
});
