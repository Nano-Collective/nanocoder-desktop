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
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult, ProjectEvent, ThreadSnapshot} from '@/shared/ipc';
import {qaEnvironment} from './qa/environment';
import {contrast} from './qa/ui-contrast';

let work: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-threads-')));
	const root = path.join(work, 'project');
	const cli = path.join(work, 'nanocoder', 'dist', 'cli.js');
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
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	page = await app.firstWindow();
	await app.evaluate(({dialog}, root) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [root],
		})) as typeof dialog.showOpenDialog;
	}, root);
});

test.afterEach(async () => {
	await app?.close();
	if (work) rmSync(work, {recursive: true, force: true});
});

test('connecting initialises Nanocoder without creating or resuming a session (CHAT-04)', async () => {
	const connected = await page.evaluate(() =>
		(window as unknown as {desktop: DesktopApi}).desktop.connectNanocoder(),
	);
	expect(connected.ok && connected.value.status).toBe('connected');
	if (!connected.ok || connected.value.status !== 'connected')
		throw new Error('Expected the fixture to connect');
	expect(Object.keys(connected.value).sort()).toEqual(['agent', 'status']);
	const diagnostics = await page.evaluate(async () => {
		const {desktop} = window as unknown as {desktop: DesktopApi};
		const ui = await desktop.getUiState({});
		if (!ui.ok || !ui.value.activeProjectId)
			throw new Error('Expected a selected project');
		return desktop.getDiagnostics({projectId: ui.value.activeProjectId});
	});
	expect(diagnostics.ok).toBe(true);
	if (!diagnostics.ok) throw new Error(diagnostics.error.code);
	expect(diagnostics.value.lines).toContain('{"method":"initialize"}');
	for (const method of ['session/new', 'session/resume', 'session/set_mode'])
		expect(diagnostics.value.lines).not.toContain(JSON.stringify({method}));
});

for (const [state, glyph] of [
	['new', '◌'],
	['ready', '○'],
	['running', '●'],
	['waiting', '◐'],
	['interrupted', '▲'],
	['archived', '░'],
	['view-only', '◍'],
] as const) {
	test(`selected ${state} glyph meets rendered AA in both themes without changing its row or selection rule (U.3)`, async () => {
		await page.emulateMedia({reducedMotion: 'reduce'});
		const root = path.join(work, 'project');
		if (state === 'running' || state === 'interrupted')
			writeFileSync(path.join(root, '.fake-nanocoder'), 'wait-for-cancel');
		await page.getByRole('button', {name: 'open a project folder'}).click();
		const selected = page.locator('.thread-row[data-selected="true"]');
		await expect(selected).toBeVisible();
		if (state !== 'new') {
			await page
				.getByRole('textbox', {name: 'message'})
				.fill('synthetic glyph');
			await page.getByRole('button', {name: 'send', exact: true}).click();
			if (state === 'running' || state === 'interrupted') {
				await expect(page.locator('.ui-badge--running')).toBeVisible();
				if (state === 'interrupted') {
					await page
						.getByRole('button', {name: 'cancel turn', exact: true})
						.click();
					await expect(
						page.getByText('turn interrupted: cancelled'),
					).toBeVisible();
				}
			} else {
				const approval = page.getByRole('region', {name: 'permission request'});
				await expect(approval).toBeVisible();
				if (state !== 'waiting') {
					await approval
						.getByRole('button', {name: 'Deny', exact: true})
						.click();
					await expect(page.getByText('turn ended: end_turn')).toBeVisible();
				}
			}
		}
		if (state === 'archived' || state === 'view-only') {
			const changed = await page.evaluate(async state => {
				const {desktop} = window as unknown as {desktop: DesktopApi};
				const ui = await desktop.getUiState({});
				if (!ui.ok || !ui.value.activeProjectId || !ui.value.activeThreadId)
					throw new Error('Expected a selected desktop thread');
				const owner = {
					projectId: ui.value.activeProjectId,
					threadId: ui.value.activeThreadId,
				};
				return state === 'archived'
					? desktop.archiveThread({...owner, archived: true})
					: desktop.stopProject({projectId: owner.projectId});
			}, state);
			expect(changed.ok).toBe(true);
			if (state === 'view-only') {
				writeFileSync(path.join(root, '.fake-nanocoder'), 'missing-session');
				await selected.locator('.thread-open').click();
				await expect(
					page.getByRole('region', {name: 'view-only thread'}),
				).toBeVisible();
			}
		}
		const marker = selected.locator('.thread-status');
		await expect(marker).toHaveText(glyph);
		for (const theme of ['dark', 'light']) {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			const rendered = await marker.evaluate(element => {
				const style = getComputedStyle(element);
				const owner = element.closest('.thread-row');
				if (!owner) throw new Error('Expected the selected thread row');
				const row = getComputedStyle(owner);
				const rgb = (value: string) =>
					value
						.match(/[\d.]+/g)
						?.slice(0, 3)
						.map(Number) as [number, number, number];
				return {
					foreground: rgb(style.color),
					background: rgb(
						style.backgroundColor === 'rgba(0, 0, 0, 0)'
							? row.backgroundColor
							: style.backgroundColor,
					),
				};
			});
			expect(
				contrast(rendered.foreground, rendered.background),
			).toBeGreaterThanOrEqual(4.5);
			await expect(selected).toHaveCSS(
				'background-color',
				theme === 'dark' ? 'rgb(35, 47, 62)' : 'rgb(218, 218, 242)',
			);
			await expect(selected).toHaveCSS('border-left-width', '2px');
			await expect(selected).toHaveCSS(
				'border-left-color',
				theme === 'dark' ? 'rgb(69, 155, 247)' : 'rgb(0, 0, 238)',
			);
			if (state === 'waiting' || state === 'interrupted')
				await expect(marker).toHaveCSS(
					'color',
					theme === 'dark' ? 'rgb(221, 167, 60)' : 'rgb(154, 103, 0)',
				);
			if (state === 'running')
				await expect(marker).toHaveCSS(
					'color',
					theme === 'dark' ? 'rgb(69, 155, 247)' : 'rgb(0, 0, 238)',
				);
		}
	});
}

test('the first thread prompt persists its real session before mapped content and answers only its own permission (CHAT-04, CHAT-06)', async () => {
	const result = await page.evaluate(async () => {
		const {desktop} = window as unknown as {desktop: DesktopApi};
		const connected = await desktop.connectNanocoder();
		const ui = await desktop.getUiState({});
		if (!connected.ok || !ui.ok || !ui.value.activeProjectId)
			throw new Error('Expected a selected project');
		const projectId = ui.value.activeProjectId;
		const created = await desktop.createThread({projectId});
		if (!created.ok) return {created};
		const threadId = created.value.id;
		const events: ProjectEvent[] = [];
		const identities: Promise<IpcResult<ThreadSnapshot>>[] = [];
		const answers: Promise<IpcResult<null>>[] = [];
		const unsubscribe = desktop.onProjectEvent(event => {
			events.push(event);
			if (event.type !== 'turn' || event.threadId !== threadId) return;
			for (const item of event.events) {
				if (item.type === 'user')
					identities.push(desktop.getThreadSnapshot({projectId, threadId}));
				if (item.type === 'permission')
					answers.push(
						desktop.answerThreadPermission({
							projectId,
							threadId,
							requestId: item.request.id,
							optionId:
								item.request.options.find(
									option => option.kind === 'reject_once',
								)?.id ?? '',
						}),
					);
			}
		});
		try {
			const prompted = await desktop.promptThread({
				projectId,
				threadId,
				text: 'synthetic thread request',
			});
			return {
				created,
				prompted,
				events,
				identities: await Promise.all(identities),
				answers: await Promise.all(answers),
				diagnostics: await desktop.getDiagnostics({projectId}),
			};
		} finally {
			unsubscribe();
		}
	});
	expect(result.created.ok).toBe(true);
	if (!result.created.ok) throw new Error(result.created.error.code);
	const threadId = result.created.value.id;
	expect(result.created.value.nanocoderSessionId).toBeNull();
	expect(result.prompted).toEqual({ok: true, value: {stopReason: 'end_turn'}});
	expect(result.answers).toEqual([{ok: true, value: null}]);
	expect(result.identities).toHaveLength(1);
	for (const identity of result.identities ?? []) {
		expect(identity.ok && identity.value.thread.nanocoderSessionId).toMatch(
			/^fake-session-[a-f0-9]{12}-[a-f0-9-]{36}$/,
		);
	}
	const turns = result.events?.filter(event => event.type === 'turn') ?? [];
	expect(turns.length).toBeGreaterThan(0);
	expect(turns.every(event => event.threadId === threadId)).toBe(true);
	expect(turns.map(event => event.sequence)).toEqual(
		turns.map((_, index) => index + 1),
	);
	expect(result.diagnostics?.ok).toBe(true);
	if (result.diagnostics?.ok) {
		const methods = result.diagnostics.value.lines.filter(line =>
			line.startsWith('{"method":'),
		);
		expect(methods.indexOf('{"method":"session/new"}')).toBeLessThan(
			methods.indexOf('{"method":"session/set_mode"}'),
		);
		expect(methods.indexOf('{"method":"session/set_mode"}')).toBeLessThan(
			methods.indexOf('{"method":"session/prompt"}'),
		);
	}
});
