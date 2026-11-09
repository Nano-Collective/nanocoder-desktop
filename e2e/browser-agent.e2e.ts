import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
const record = () => path.join(work, 'mcp-servers.json');
let project: string;
let app: ElectronApplication;
let page: Page;
let server: Server;
let origin: string;
let received: string[];

const FIXTURE = `<!doctype html><title>Agent fixture</title>
<h1>Agent fixture</h1>
<p id="more" hidden>More content arrived</p>
<button id="show" onclick="document.getElementById('more').hidden = false">Show more</button>
<label>Your name <input id="name" name="fullname"></label>
<form method="post" action="/save"><input name="q"><button>Save</button></form>
<label>Password <input id="pw" type="password"></label>
<a id="dl" href="/file.txt" download>Get file</a>
<div style="position: relative"><button id="under">Hidden under</button><div style="position: absolute; inset: 0; background: white"></div></div>
<button id="ping" onclick="fetch('/ping', {method: 'POST', body: 'data'}).catch(() => {})">Ping</button>
<a id="out" href="https://example.com/">Outside</a>
<a id="next" href="/next">Next page</a>
<label>Email <input id="email" type="email" value="ada@"></label>
<div id="notes" contenteditable="true">Start</div>
${'<p>Filler paragraph with a few words in it.</p>'.repeat(30)}
<div style="height: 3000px"></div>
<p id="bottom">Bottom of the page</p>`;

const TAMPERED = `<!doctype html><title>Tampered</title>
<script>
Element.prototype.getBoundingClientRect = () => ({x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0});
Document.prototype.querySelector = () => null;
window.getComputedStyle = () => ({display: 'none', visibility: 'hidden'});
</script>
<button id="real" onclick="document.title = 'clicked'">Real button</button>`;

test.beforeEach(async () => {
	received = [];
	server = createServer((request, response) => {
		received.push(`${request.method} ${request.url}`);
		const pages: Record<string, string> = {
			'/': FIXTURE,
			'/next': '<!doctype html><title>Next</title><p>Next page body</p>',
			'/tampered': TAMPERED,
		};
		const body = pages[request.url ?? ''];
		if (request.url === '/file.txt') {
			response.writeHead(200, {
				'Content-Type': 'text/plain',
				'Content-Disposition': 'attachment; filename="file.txt"',
			});
			response.end('file');
			return;
		}
		response.writeHead(body ? 200 : 404, {'Content-Type': 'text/html'});
		response.end(body ?? 'missing');
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-agent-')));
	project = path.join(work, 'project');
	mkdirSync(project);
	writeFileSync(path.join(project, '.fake-mcp-http'), '');
	// A turn that finishes without asking, so a later chat is not held behind it.
	writeFileSync(path.join(project, '.fake-nanocoder'), 'files');
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
		env: {
			...qaEnvironment(process.env, {
				cliPath: fakeCli,
				nodePath: process.execPath,
			}),
			NANOCODER_TEST_MCP_RECORD: record(),
		},
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
	const composer = page.getByRole('textbox', {name: 'message', exact: true});
	await expect(composer).toBeEnabled();
	await composer.fill('hello');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect.poll(() => existsSync(record())).toBe(true);
	await page.getByRole('button', {name: 'open browser', exact: true}).click();
	await expect(page.getByRole('textbox', {name: 'address'})).toBeVisible();
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

let rpcId = 0;
interface ToolResult {
	content: Array<
		| {type: 'text'; text: string}
		| {type: 'image'; data: string; mimeType: string}
	>;
	isError: boolean;
}

// Calls the desktop's server with the secret this session was given, as Nanocoder would.
async function agent(
	name: string,
	args: Record<string, unknown> = {},
): Promise<{text: string; isError: boolean; result: ToolResult}> {
	const {
		mcpServers: [entry],
	} = JSON.parse(readFileSync(record(), 'utf8')) as {
		mcpServers: Array<{
			url: string;
			headers: Array<{name: string; value: string}>;
		}>;
	};
	const response = await fetch(entry.url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...Object.fromEntries(entry.headers.map(h => [h.name, h.value])),
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++rpcId,
			method: 'tools/call',
			params: {name, arguments: args},
		}),
	});
	const result = ((await response.json()) as {result: ToolResult}).result;
	const first = result.content[0];
	return {
		text: first?.type === 'text' ? first.text : '',
		isError: result.isError,
		result,
	};
}

// The tab reports its on-screen size to main after it appears; until then the agent is refused.
async function openAsAgent(url: string): Promise<string> {
	let text = '';
	await expect
		.poll(async () => {
			const opened = await agent('desktop_browser_open', {url});
			text = opened.text;
			return opened.isError && text.includes('not on screen');
		})
		.toBe(false);
	expect(text).toMatch(/^Opened\./);
	return text;
}

const refOf = (snapshot: string, label: string) => {
	for (const line of snapshot.split('\n')) {
		const match = /^\[(e\d+)\] \w+ "(.*)"/.exec(line);
		if (match?.[2] === label) return match[1];
	}
	throw new Error(`No reference for ${label} in:\n${snapshot}`);
};

const inPage = (code: string) =>
	app.evaluate(
		({webContents}, args) => {
			const contents = webContents
				.getAllWebContents()
				.find(candidate => candidate.getURL().startsWith(args.origin));
			return contents?.executeJavaScript(args.code);
		},
		{origin, code},
	);

async function browserUrl(): Promise<string | null> {
	return page.evaluate(async () => {
		const desktop = (window as unknown as {desktop: DesktopApi}).desktop;
		const projects = await desktop.listProjects({});
		if (!projects.ok) return null;
		const snapshot = await desktop.browser.get({
			projectId: projects.value[0].id,
		});
		return snapshot.ok ? snapshot.value.url : null;
	});
}

test('BRW-11 the agent opens the local dev server, takes a snapshot, clicks a button and types, all in the visible browser', async () => {
	const opened = await openAsAgent(`${origin}/`);
	expect(opened).toContain('page data from the in-app browser');
	await expect.poll(browserUrl).toBe(`${origin}/`);
	await expect(page.getByRole('textbox', {name: 'address'})).toHaveValue(
		`${origin}/`,
	);

	const first = await agent('desktop_browser_snapshot');
	expect(first.text).toContain('heading "Agent fixture"');
	expect(first.text).toContain('[e');
	expect(first.text).not.toContain('More content arrived');
	expect(first.text).toMatch(/textbox "Password" value hidden/);

	const clicked = await agent('desktop_browser_click', {
		ref: refOf(first.text, 'Show more'),
	});
	expect(clicked.isError).toBe(false);
	expect(clicked.text).toMatch(/^Clicked \[e\d+\] button "Show more"\./);
	const waited = await agent('desktop_browser_wait', {
		for: 'text',
		value: 'More content arrived',
		timeoutMs: 5000,
	});
	expect(waited.isError).toBe(false);

	const typed = await agent('desktop_browser_type', {
		selector: '#name',
		text: 'Ada Lovelace',
	});
	expect(typed.text).toMatch(
		/^Typed 12 characters into \[e\d+\] textbox "Your name"/,
	);
	expect(await inPage("document.getElementById('name').value")).toBe(
		'Ada Lovelace',
	);
	await agent('desktop_browser_type', {
		selector: '#name',
		text: 'Grace',
		clear: true,
	});
	expect(await inPage("document.getElementById('name').value")).toBe('Grace');
	await agent('desktop_browser_type', {
		selector: '#email',
		text: 'example.com',
	});
	expect(await inPage("document.getElementById('email').value")).toBe(
		'ada@example.com',
	);
	await agent('desktop_browser_type', {selector: '#notes', text: ' end'});
	expect(await inPage("document.getElementById('notes').innerText")).toBe(
		'Start end',
	);
	const short = await agent('desktop_browser_snapshot', {maxChars: 500});
	expect(short.text).toContain('[truncated at 500 characters]');
	expect(short.text.length).toBeLessThan(1500);

	const scrolled = await agent('desktop_browser_scroll', {
		direction: 'down',
		amount: 800,
	});
	expect(scrolled.text).toMatch(/^Scrolled\. Position 0,800 of /);
	await agent('desktop_browser_scroll', {selector: '#bottom'});
	expect(await inPage('Math.round(scrollY) > 800')).toBe(true);

	const shot = await agent('desktop_browser_screenshot');
	expect(shot.text).toMatch(
		/^Screenshot of http:\/\/127\.0\.0\.1:\d+\/ \(\d+x\d+\), page data/,
	);
	const image = shot.result.content[1];
	expect(image?.type).toBe('image');
	if (image?.type !== 'image') throw new Error('No image');
	expect(image.mimeType).toBe('image/jpeg');
	expect(Buffer.from(image.data, 'base64').subarray(0, 3)).toEqual(
		Buffer.from([0xff, 0xd8, 0xff]),
	);

	const link = await agent('desktop_browser_click', {selector: '#next'});
	expect(link.text).toContain(`URL: ${origin}/next`);
	await expect.poll(browserUrl).toBe(`${origin}/next`);
	const back = await agent('desktop_browser_back');
	expect(back.text).toContain(`URL: ${origin}/`);
	const status = await agent('desktop_browser_status');
	expect(status.text).toContain(`URL: ${origin}/`);
});

test('BRW-13 BRW-16 submits, downloads, password fields, covered targets, data requests and public sites are refused or cancelled', async () => {
	await openAsAgent(`${origin}/`);
	await expect.poll(browserUrl).toBe(`${origin}/`);

	const submit = await agent('desktop_browser_click', {
		selector: 'form button',
	});
	expect(submit.isError).toBe(true);
	expect(submit.text).toContain('it would submit a form');
	const download = await agent('desktop_browser_click', {selector: '#dl'});
	expect(download.text).toContain('it would start a download');
	const password = await agent('desktop_browser_type', {
		selector: '#pw',
		text: 'hunter2',
	});
	expect(password.text).toContain('it is a password field');
	expect(await inPage("document.getElementById('pw').value")).toBe('');
	const covered = await agent('desktop_browser_click', {selector: '#under'});
	expect(covered.text).toContain('Another element covers it');

	const ping = await agent('desktop_browser_click', {selector: '#ping'});
	expect(ping.isError).toBe(false);
	expect(ping.text).toContain('tried to send data');
	const outside = await agent('desktop_browser_click', {selector: '#out'});
	expect(outside.text).toContain('tried to leave local addresses');
	await expect.poll(browserUrl).toBe(`${origin}/`);
	const open = await agent('desktop_browser_open', {
		url: 'https://example.com/',
	});
	expect(open.isError).toBe(true);
	expect(open.text).toContain('limited to local addresses');

	expect(received.filter(line => !line.startsWith('GET '))).toEqual([]);
	expect(received).not.toContain('GET /file.txt');
	expect(await browserUrl()).toBe(`${origin}/`);
});

test('SEC-13 the page cannot see or bend the agent helpers, and cannot reach them from its own scripts', async () => {
	await openAsAgent(`${origin}/tampered`);
	await expect.poll(browserUrl).toBe(`${origin}/tampered`);
	const snapshot = await agent('desktop_browser_snapshot');
	const ref = refOf(snapshot.text, 'Real button');
	const clicked = await agent('desktop_browser_click', {ref});
	expect(clicked.isError).toBe(false);
	expect(await inPage('document.title')).toBe('clicked');
	expect(await inPage('typeof globalThis.__ndBroker')).toBe('undefined');
});

test('BRW-17 the agent cannot act while the browser is off screen, and a stale reference is refused', async () => {
	await openAsAgent(`${origin}/`);
	const snapshot = await agent('desktop_browser_snapshot');
	const ref = refOf(snapshot.text, 'Show more');
	await agent('desktop_browser_snapshot');
	const stale = await agent('desktop_browser_click', {ref});
	expect(stale.text).toContain('no longer on the page');
	await page.getByRole('button', {name: 'close panel'}).click();
	await expect(page.getByRole('textbox', {name: 'address'})).toHaveCount(0);
	const hidden = await agent('desktop_browser_snapshot');
	expect(hidden.isError).toBe(true);
	expect(hidden.text).toContain('not on screen');
});

const recordedMeta = () =>
	(JSON.parse(readFileSync(record(), 'utf8')) as {meta: unknown}).meta;

test("BRW-18 Nanocoder's own browser is off by default, and the browser tab turns it on for the next chat", async () => {
	expect(recordedMeta()).toEqual({'nanocoder/disabledTools': ['browser']});
	const toggle = page.getByRole('checkbox', {name: "nanocoder's own browser"});
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	await expect(toggle).toBeChecked();
	const note = page.getByText("nanocoder's own browser is on");
	await expect(note).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-describedby', /.+/);
	expect(
		await page.evaluate(async () => {
			const desktop = (window as unknown as {desktop: DesktopApi}).desktop;
			const settings = await desktop.getSettings({});
			return settings.ok ? settings.value.nanocoderBrowserEnabled : null;
		}),
	).toBe(true);

	rmSync(record());
	await page
		.getByRole('region', {name: 'project threads'})
		.getByRole('button', {name: 'new thread', exact: true})
		.click();
	const dialog = page.getByRole('dialog', {name: 'new thread', exact: true});
	await dialog
		.getByRole('button', {name: 'keep as new thread draft', exact: true})
		.click();
	await expect(dialog).toBeHidden();
	const composer = page.getByRole('textbox', {name: 'message', exact: true});
	await composer.fill('second chat');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect.poll(() => existsSync(record())).toBe(true);
	expect(recordedMeta()).toBeNull();

	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await expect(note).toHaveCount(0);
});
