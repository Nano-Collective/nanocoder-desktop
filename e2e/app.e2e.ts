import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
	type ElectronApplication,
	expect,
	type Page,
	test,
} from '@playwright/test';
import type {DesktopApi} from '@/shared/desktop-api';
import {CHANNELS, type ProjectEvent} from '@/shared/ipc';
import {electron} from './qa/electron';

let app: ElectronApplication;
let page: Page;
const profile = mkdtempSync(path.join(tmpdir(), 'nd-app-e2e-'));

test.beforeAll(async () => {
	app = await electron.launch({args: ['.', `--user-data-dir=${profile}`]});
	page = await app.firstWindow();
});

test.afterAll(async () => {
	await app.close();
	rmSync(profile, {recursive: true, force: true});
});

test('shows the app shell, loaded over IPC', async () => {
	await expect(page.getByRole('heading', {level: 1})).toHaveText(
		'Nanocoder Desktop',
	);
});

test('the preload bridge exposes typed methods only', async () => {
	const keys = await page.evaluate(() =>
		Object.keys((window as {desktop?: object}).desktop ?? {}),
	);
	expect(keys.sort()).toEqual(
		[
			...Object.keys(CHANNELS).filter(key => key !== 'projectEvent'),
			'onProjectEvent',
		].sort(),
	);
	expect(keys).not.toContain('ipcRenderer');
});

test('project selection uses main and cancellation saves no project', async () => {
	await app.evaluate(({dialog}) => {
		const state = globalThis as {appProjectPickerCalls?: number};
		state.appProjectPickerCalls = 0;
		dialog.showOpenDialog = (async () => {
			state.appProjectPickerCalls = (state.appProjectPickerCalls ?? 0) + 1;
			return {canceled: true, filePaths: []};
		}) as typeof dialog.showOpenDialog;
	});
	const result = await page.evaluate(() =>
		(window as unknown as {desktop: DesktopApi}).desktop.addProject({}),
	);
	expect(result).toEqual({
		ok: true,
		value: {status: 'cancelled'},
	});
	expect(
		await app.evaluate(
			() =>
				(globalThis as {appProjectPickerCalls?: number}).appProjectPickerCalls,
		),
	).toBe(1);
	expect(
		await page.evaluate(() =>
			(window as unknown as {desktop: DesktopApi}).desktop.listProjects({}),
		),
	).toEqual({ok: true, value: []});
});

test('workspace methods reject content and renderer-supplied paths', async () => {
	const results = await page.evaluate(async () => {
		const desktop = (window as unknown as {desktop: DesktopApi}).desktop;
		return Promise.all([
			desktop.updateUiState({patch: {messages: ['not stored']}} as never),
			desktop.addProject({canonicalRoot: '/not-picked'} as never),
		]);
	});
	for (const result of results) {
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('VALIDATION');
	}
});

test('project subscriptions expose data only and can stop listening', async () => {
	const event: ProjectEvent = {
		type: 'turn',
		projectId: '11111111-1111-4111-8111-111111111111',
		threadId: '22222222-2222-4222-8222-222222222222',
		sequence: 1,
		events: [{type: 'text', text: 'fixture only'}],
	};
	await page.evaluate(() => {
		const state = window as unknown as {
			desktop: DesktopApi;
			projectEvents: unknown[];
			stopProjectEvents: () => void;
		};
		state.projectEvents = [];
		state.stopProjectEvents = state.desktop.onProjectEvent((...args) => {
			state.projectEvents.push(args);
		});
	});
	await app.evaluate(
		({BrowserWindow}, {channel, value}) => {
			BrowserWindow.getAllWindows()[0].webContents.send(channel, value);
		},
		{channel: CHANNELS.projectEvent, value: event},
	);
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as {projectEvents: unknown[]}).projectEvents,
			),
		)
		.toEqual([[event]]);
	await page.evaluate(() =>
		(window as unknown as {stopProjectEvents: () => void}).stopProjectEvents(),
	);
	await app.evaluate(
		({BrowserWindow}, {channel, value}) => {
			BrowserWindow.getAllWindows()[0].webContents.send(channel, value);
		},
		{channel: CHANNELS.projectEvent, value: {...event, sequence: 2}},
	);
	// Invoke IPC after the pushed event, then inspect the same renderer queue.
	await page.evaluate(() =>
		(window as unknown as {desktop: DesktopApi}).desktop.getAppInfo(),
	);
	expect(
		await page.evaluate(
			() => (window as unknown as {projectEvents: unknown[]}).projectEvents,
		),
	).toEqual([[event]]);
});

test('thread-scoped methods replace every prototype turn capability', async () => {
	const keys = await page.evaluate(() =>
		Object.keys((window as {desktop?: object}).desktop ?? {}),
	);
	expect(keys).toEqual(
		expect.arrayContaining([
			'getAppInfo',
			'getNanocoderRuntime',
			'connectNanocoder',
			'promptThread',
			'cancelThread',
			'answerThreadPermission',
			'onProjectEvent',
		]),
	);
	for (const retired of [
		'sendPrompt',
		'answerPermission',
		'cancelPrompt',
		'onNanocoderEvent',
	])
		expect(keys).not.toContain(retired);
});

test('the bridge returns the standard result shape', async () => {
	const result = await page.evaluate(() =>
		(
			window as {desktop?: {getAppInfo(): Promise<unknown>}}
		).desktop?.getAppInfo(),
	);
	expect(result).toEqual({
		ok: true,
		value: {name: 'Nanocoder Desktop', version: expect.any(String)},
	});
});

test('reports the Nanocoder runtime or why it is unavailable', async () => {
	const result = (await page.evaluate(() =>
		(
			window as {desktop?: {getNanocoderRuntime(): Promise<unknown>}}
		).desktop?.getNanocoderRuntime(),
	)) as {ok: boolean; value?: Record<string, string>; error?: {code: string}};
	if (result.ok) {
		expect(result.value?.cliPath).toMatch(/cli\.js$/);
		expect(result.value?.nodeVersion).toMatch(/^v\d+\./);
	} else {
		expect(['NOT_FOUND', 'DENIED', 'UNSUPPORTED']).toContain(
			result.error?.code,
		);
	}
});

test('loads the renderer over the app protocol, not file://', async () => {
	expect(page.url()).toBe('app://renderer/index.html');
});

test('the renderer cannot reach Node', async () => {
	const reachable = await page.evaluate(() => ({
		require: typeof (globalThis as {require?: unknown}).require,
		process: typeof (globalThis as {process?: unknown}).process,
	}));
	expect(reachable).toEqual({require: 'undefined', process: 'undefined'});
});

test('the renderer cannot open windows', async () => {
	const opened = await page.evaluate(
		() => window.open('https://example.com/') !== null,
	);
	expect(opened).toBe(false);
	expect(app.windows()).toHaveLength(1);
});

test('the renderer cannot navigate away', async () => {
	const before = page.url();
	await app.evaluate(({BrowserWindow}) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents;
		(globalThis as {navigationBlocked?: Promise<boolean>}).navigationBlocked =
			new Promise(resolve => {
				contents.once('will-navigate', event =>
					resolve(event.defaultPrevented),
				);
			});
	});
	await page.evaluate(() => {
		window.location.href = 'https://example.com/';
	});
	const blocked = await app.evaluate(
		() =>
			(globalThis as {navigationBlocked?: Promise<boolean>}).navigationBlocked,
	);
	expect(blocked).toBe(true);
	expect(page.url()).toBe(before);
});

test('the content security policy blocks inline scripts', async () => {
	const ran = await page.evaluate(() => {
		const script = document.createElement('script');
		script.textContent = 'window.inlineScriptRan = true';
		document.body.append(script);
		return (window as {inlineScriptRan?: boolean}).inlineScriptRan === true;
	});
	expect(ran).toBe(false);
});

test('node:sqlite works in the main process', async () => {
	const rows = await app.evaluate(() => {
		const {DatabaseSync} = process.getBuiltinModule('node:sqlite');
		const db = new DatabaseSync(':memory:');
		db.exec('CREATE TABLE t (x INTEGER)');
		db.prepare('INSERT INTO t VALUES (?)').run(1);
		const row = db.prepare('SELECT COUNT(*) AS n FROM t').get() as {n: number};
		db.close();
		return row.n;
	});
	expect(rows).toBe(1);
});
