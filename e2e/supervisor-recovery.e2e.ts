import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
import type {ProjectEvent} from '@/shared/ipc';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

let work: string;
let root: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
	work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-recovery-e2e-')),
	);
	root = path.join(work, 'project');
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
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
	}, root);
	await page.evaluate(() => {
		const state = window as unknown as {
			desktop: DesktopApi;
			recoveryEvents: ProjectEvent[];
		};
		state.recoveryEvents = [];
		state.desktop.onProjectEvent(event => state.recoveryEvents.push(event));
	});
});
test.afterEach(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

async function open(mode = 'ok'): Promise<string> {
	writeFileSync(path.join(root, '.fake-nanocoder'), mode);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
	return page.evaluate(() => {
		const events = (window as unknown as {recoveryEvents: ProjectEvent[]})
			.recoveryEvents;
		const event = events.find(
			event => event.type === 'supervisor' && event.state.status === 'ready',
		);
		if (!event) throw new Error('Missing ready state');
		return event.projectId;
	});
}

test('a crashed turn disables the composer and keyboard retry resumes without resending it', async () => {
	const projectId = await open('die-in-turn');
	await page
		.getByRole('textbox', {name: 'message', exact: true})
		.fill('synthetic failed request');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	const recovery = page
		.locator('[data-shell-slot="stream-tools"]')
		.getByRole('region', {name: 'Nanocoder recovery'});
	await expect(recovery).toContainText('exit code 3');
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeDisabled();
	await page.evaluate(async id => {
		await (window as unknown as {desktop: DesktopApi}).desktop.stopProject({
			projectId: id,
		});
	}, projectId);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'ok');
	const retry = recovery.getByRole('button', {
		name: 'retry Nanocoder',
		exact: true,
	});
	await retry.focus();
	await expect(retry).toBeFocused();
	await retry.press('Enter');
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
	await expect(page.getByRole('list', {name: 'conversation'})).toContainText(
		'Earlier answer',
	);
	await expect(
		page
			.locator('.gate-message-user .stream-plain')
			.getByText('synthetic failed request', {exact: true}),
	).toHaveCount(0);
	await expect(page.locator('.ui-badge--failed')).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.locator('.gate-message-failure')).toContainText(
		'Nanocoder stopped during the turn',
	);
	const snapshot = await page.evaluate(async id => {
		const result = await (
			window as unknown as {desktop: DesktopApi}
		).desktop.getDiagnostics({projectId: id});
		if (!result.ok) throw new Error(result.error.code);
		return result.value;
	}, projectId);
	expect(
		snapshot.lines.filter(line => line === '{"method":"session/prompt"}'),
	).toHaveLength(1);
});

test('ordinary reopen preserves the existing conversation when no replay is produced', async () => {
	const projectId = await open();
	await page
		.getByRole('textbox', {name: 'message', exact: true})
		.fill('fixture conversation');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await page
		.getByRole('region', {name: 'permission request'})
		.getByRole('button', {name: 'Deny', exact: true})
		.click();
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
	const conversation = page.getByRole('list', {name: 'conversation'});
	const before = await conversation.innerText();
	await expect(conversation.locator('li')).toHaveCount(4);
	await page.evaluate(async projectId => {
		await (window as unknown as {desktop: DesktopApi}).desktop.stopProject({
			projectId,
		});
	}, projectId);
	await open();
	await expect(conversation.locator('li')).toHaveCount(4);
	await expect(conversation).toHaveText(before, {useInnerText: true});
});

for (const {failure, action} of [
	{failure: 'untrusted', action: 'open a project folder'},
	{failure: 'crash', action: 'open a project folder'},
	{failure: 'untrusted', action: 'add project folder'},
	{failure: 'crash', action: 'add project folder'},
]) {
	test(`retry after an initial ${failure} via ${action} prepares a usable session without reopening the picker`, async () => {
		writeFileSync(path.join(root, '.fake-nanocoder'), failure);
		await app.evaluate(({dialog}, root) => {
			const state = globalThis as {recoveryPickerCalls?: number};
			state.recoveryPickerCalls = 0;
			dialog.showOpenDialog = (async () => {
				state.recoveryPickerCalls = (state.recoveryPickerCalls ?? 0) + 1;
				return {canceled: false, filePaths: [root]};
			}) as typeof dialog.showOpenDialog;
			dialog.showMessageBox = (async () => ({
				response: 1,
				checkboxChecked: false,
			})) as typeof dialog.showMessageBox;
		}, root);
		await page.getByRole('button', {name: action, exact: true}).click();
		await expect(
			page.getByRole('region', {name: 'Nanocoder recovery'}),
		).toContainText('Nanocoder is not ready');
		writeFileSync(
			path.join(root, '.fake-nanocoder'),
			failure === 'untrusted' ? 'untrusted' : 'ok',
		);
		await app.evaluate(({dialog}) => {
			dialog.showMessageBox = (async () => ({
				response: 0,
				checkboxChecked: false,
			})) as typeof dialog.showMessageBox;
		});
		await page
			.getByRole('button', {name: 'retry Nanocoder', exact: true})
			.click();
		const input = page.getByRole('textbox', {name: 'message', exact: true});
		await expect(input).toBeEnabled();
		await expect(page.locator('.ui-badge--failed')).toHaveCount(0);
		await input.fill('synthetic first retry turn');
		await page.getByRole('button', {name: 'send', exact: true}).click();
		await expect(
			page.getByRole('region', {name: 'permission request'}),
		).toBeVisible();
		await page
			.getByRole('region', {name: 'permission request'})
			.getByRole('button', {name: 'Deny', exact: true})
			.click();
		await expect(page.getByText('turn ended: end_turn')).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
		expect(
			await app.evaluate(
				() =>
					(globalThis as {recoveryPickerCalls?: number}).recoveryPickerCalls,
			),
		).toBe(1);
		const projects = await page.evaluate(() =>
			(window as unknown as {desktop: DesktopApi}).desktop.listProjects({}),
		);
		expect(projects).toMatchObject({
			ok: true,
			value: [{canonicalRoot: root, trusted: true}],
		});
	});
}

test('recovery remains bound to the failed attempted project when another project emits ready', async () => {
	const firstId = await open();
	const other = path.join(work, 'failed-project');
	mkdirSync(other);
	writeFileSync(path.join(other, '.fake-nanocoder'), 'untrusted');
	await app.evaluate(({dialog}, other) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [other],
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (async () => ({
			response: 1,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
	}, other);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(page.getByRole('alert')).toContainText('not opened');
	await page.evaluate(async firstId => {
		const api = (window as unknown as {desktop: DesktopApi}).desktop;
		await api.stopProject({projectId: firstId});
		const started = await api.startProject({projectId: firstId});
		if (!started.ok || started.value.status !== 'ready')
			throw new Error('Expected the other project to be ready');
	}, firstId);
	await expect(
		page.getByRole('button', {name: 'retry Nanocoder', exact: true}),
	).toBeVisible();
	await page.getByRole('button', {name: 'diagnostics', exact: true}).click();
	await expect(
		page.getByRole('region', {name: 'captured diagnostics'}),
	).toContainText(other);
	await expect(
		page.getByRole('region', {name: 'captured diagnostics'}),
	).not.toContainText(root);
});

test('diagnostics export reviews the exact snapshot and cancellation never writes', async () => {
	await open();
	const target = path.join(work, 'reviewed.txt');
	await app.evaluate(({dialog}, target) => {
		const state = globalThis as {reviewed?: string[]; exports?: number};
		state.reviewed = [];
		state.exports = 0;
		dialog.showMessageBox = (async (...args: unknown[]) => {
			const options = args.at(-1) as {detail?: string};
			state.reviewed?.push(options.detail ?? '');
			return {
				response: state.reviewed?.length === 1 ? 1 : 0,
				checkboxChecked: false,
			};
		}) as typeof dialog.showMessageBox;
		dialog.showSaveDialog = (async () => {
			state.exports = (state.exports ?? 0) + 1;
			return {canceled: false, filePath: target};
		}) as typeof dialog.showSaveDialog;
	}, target);
	await page.getByRole('button', {name: 'diagnostics', exact: true}).click();
	const diagnostics = page
		.locator('[data-shell-slot="stream-tools"]')
		.getByRole('region', {name: 'redacted diagnostics'});
	await expect(diagnostics).toBeVisible();
	const captured = await diagnostics.locator('pre').innerText();
	await diagnostics
		.getByRole('button', {name: 'review and export', exact: true})
		.click();
	await expect(diagnostics).toContainText('export cancelled');
	expect(
		await app.evaluate(() => (globalThis as {exports?: number}).exports),
	).toBe(0);
	await diagnostics
		.getByRole('button', {name: 'review and export', exact: true})
		.click();
	await expect(diagnostics).toContainText('diagnostics exported');
	expect(readFileSync(target, 'utf8')).toBe(captured);
	expect(
		await app.evaluate(() => (globalThis as {reviewed?: string[]}).reviewed),
	).toEqual([captured, captured]);
});

test('failed resume preserves the visible failed turn and cannot accept another prompt', async () => {
	const projectId = await open('die-in-turn');
	await page
		.getByRole('textbox', {name: 'message', exact: true})
		.fill('synthetic failed request');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	const recovery = page.getByRole('region', {name: 'Nanocoder recovery'});
	await expect(recovery).toContainText('exit code 3');
	await page.evaluate(async projectId => {
		await (window as unknown as {desktop: DesktopApi}).desktop.stopProject({
			projectId,
		});
	}, projectId);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'missing-session');
	await recovery
		.getByRole('button', {name: 'retry Nanocoder', exact: true})
		.click();
	await expect(recovery).toContainText('no longer has this session');
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeDisabled();
	await expect(
		page
			.locator('.gate-message-user .stream-plain')
			.getByText('synthetic failed request', {exact: true}),
	).toHaveCount(1);
});

test('repeated fake-child signal exits exhaust automatic recovery until explicit retry', async () => {
	const projectId = await open();
	const getState = () =>
		page.evaluate(async projectId => {
			const result = await (
				window as unknown as {desktop: DesktopApi}
			).desktop.getSupervisorState({projectId});
			if (!result.ok) throw new Error(result.error.code);
			return result.value;
		}, projectId);
	for (let attempt = 1; attempt <= 4; attempt++) {
		const child = await page.evaluate(async projectId => {
			const result = await (
				window as unknown as {desktop: DesktopApi}
			).desktop.getDiagnostics({projectId});
			if (!result.ok) throw new Error(result.error.code);
			return result.value.lines
				.flatMap(line => {
					try {
						return [
							JSON.parse(line) as {
								started?: boolean;
								pid?: number;
								cwd?: string;
							},
						];
					} catch {
						return [];
					}
				})
				.reverse()
				.find(event => event.started);
		}, projectId);
		if (!child?.pid || child.cwd !== root)
			throw new Error('Missing isolated fake child');
		process.kill(child.pid, 'SIGTERM');
		await expect
			.poll(async () => {
				const state = await getState();
				return {status: state.status, attempt: state.restart.attempt};
			})
			.toEqual({status: 'failed', attempt: Math.min(attempt, 3)});
		if (attempt <= 3)
			await expect
				.poll(async () => (await getState()).status, {timeout: 10_000})
				.toBe('ready');
	}
	const recovery = page.getByRole('region', {name: 'Nanocoder recovery'});
	await expect(recovery).toContainText(
		'automatic recovery stopped after 3 attempts',
	);
	expect((await getState()).restart.nextAttemptAt).toBeNull();
	await recovery
		.getByRole('button', {name: 'retry Nanocoder', exact: true})
		.click();
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
	expect((await getState()).restart.attempt).toBe(0);
});

test('built main refuses unknown recovery handles and renderer-supplied paths or diagnostics lines', async () => {
	const projectId = await open();
	const results = await page.evaluate(async projectId => {
		const desktop = (window as unknown as {desktop: DesktopApi}).desktop;
		return [
			await desktop.restartProject({
				projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			}),
			await desktop.restartProject({
				projectId,
				canonicalRoot: '/renderer-path',
			} as {projectId: string}),
			await desktop.exportDiagnostics({
				projectId,
				snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				path: '/renderer-path',
				lines: ['unreviewed'],
			} as {projectId: string; snapshotId: string}),
		];
	}, projectId);
	expect(
		results.map(result =>
			result.ok ? 'unexpected-success' : result.error.code,
		),
	).toEqual(['NOT_FOUND', 'VALIDATION', 'VALIDATION']);
});
