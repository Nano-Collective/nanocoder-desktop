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
import type {IpcResult} from '@/shared/ipc';
import type {TerminalRequests, TerminalSnapshot} from '@/shared/terminal';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

let work: string;
let app: ElectronApplication;
let page: Page;
let projectId: string;

function call<K extends keyof TerminalRequests>(
	key: K,
	request: TerminalRequests[K],
): Promise<IpcResult<TerminalSnapshot>> {
	return page.evaluate(
		({key, request}) => {
			const api = (window as unknown as {desktop: DesktopApi}).desktop.terminal;
			return (
				api[key] as (request: unknown) => Promise<IpcResult<TerminalSnapshot>>
			)(request);
		},
		{key, request},
	);
}

test.beforeEach(async () => {
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-terminal-')));
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
	rmSync(work, {recursive: true, force: true});
});

test('TERM-01/04/07 built main hosts a real UTF-8 PTY and stop leaves no nested server', async () => {
	test.skip(
		process.platform === 'win32',
		'POSIX shell fixture; Windows tree coverage requires its PowerShell fixture',
	);
	expect(await call('start', {projectId})).toMatchObject({
		ok: true,
		value: {status: 'running'},
	});
	const server = path.join(work, 'server.cjs');
	writeFileSync(
		server,
		'process.on("SIGTERM",()=>{}); process.on("SIGHUP",()=>{}); require("node:net").createServer().listen(0,"127.0.0.1",()=>process.stdout.write("SERVER_PID="+process.pid+"\\n"));',
	);
	await call('write', {projectId, data: `"${process.execPath}" "${server}"\r`});
	let serverPid = 0;
	await expect
		.poll(async () => {
			const result = await call('get', {projectId});
			if (!result.ok) return false;
			const match = /SERVER_PID=(\d+)/u.exec(result.value.output);
			if (match) serverPid = Number(match[1]);
			return !!match;
		})
		.toBe(true);
	expect(() => process.kill(serverPid, 0)).not.toThrow();
	expect(await call('stop', {projectId})).toMatchObject({
		ok: true,
		value: {status: 'stopped', output: ''},
	});
	await expect
		.poll(() => {
			try {
				process.kill(serverPid, 0);
				return true;
			} catch {
				return false;
			}
		})
		.toBe(false);
	expect(await call('restart', {projectId})).toMatchObject({
		ok: true,
		value: {status: 'running'},
	});
	await call('write', {
		projectId,
		data: "printf '\\143\\141\\146\\303\\251 😀\\n'\r",
	});
	await expect
		.poll(async () => {
			const result = await call('get', {projectId});
			return result.ok && result.value.output.includes('café 😀');
		})
		.toBe(true);
});
