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
import {type ElectronApplication, expect, test} from '@playwright/test';
import {captureLaunchIdentity} from '@/main/nanocoder/launch';
import type {DesktopApi} from '@/shared/desktop-api';
import type {ProjectEvent, SupervisorState} from '@/shared/ipc';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

type FixtureWindow = {
	desktop: DesktopApi;
	events: ProjectEvent[];
	unsupported: Promise<SupervisorState>;
};

test('an inconclusive preflight allows one explicit UI Retry, but an unguarded Retry never launches the project or grants trust (ACP-20)', async () => {
	const work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-preflight-e2e-')),
	);
	let app: ElectronApplication | undefined;
	try {
		const root = path.join(work, 'project');
		const cli = path.join(work, 'nanocoder', 'dist', 'cli.js');
		mkdirSync(path.dirname(cli), {recursive: true});
		mkdirSync(root);
		writeFileSync(
			path.join(work, 'nanocoder', 'package.json'),
			JSON.stringify({
				name: '@nanocollective/nanocoder',
				version: '1.31.0',
				type: 'module',
				bin: {nanocoder: 'dist/cli.js'},
			}),
		);
		copyFileSync(
			'source/main/nanocoder/fixtures/fake-trust-preflight.mjs',
			cli,
		);
		const behaviour = path.join(path.dirname(cli), 'preflight-behaviour');
		writeFileSync(behaviour, 'timeout');
		const runtime = {
			nodePath: process.execPath,
			cliPath: cli,
			version: '1.31.0',
		};
		const before = captureLaunchIdentity(runtime);
		app = await electron.launch({
			args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
			env: qaEnvironment(process.env, {
				cliPath: cli,
				nodePath: process.execPath,
			}),
		});
		const page = await app.firstWindow();
		await app.evaluate(({dialog}, folder) => {
			const state = globalThis as unknown as {trustPrompts: number};
			state.trustPrompts = 0;
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [folder],
			})) as typeof dialog.showOpenDialog;
			dialog.showMessageBox = (async () => {
				state.trustPrompts++;
				return {response: 0, checkboxChecked: false};
			}) as typeof dialog.showMessageBox;
		}, root);
		await page.evaluate(() => {
			const state = window as unknown as FixtureWindow;
			state.events = [];
			state.desktop.onProjectEvent(event => state.events.push(event));
		});
		const unsupportedAfter = async (action: () => Promise<void>) => {
			await page.evaluate(() => {
				const state = window as unknown as FixtureWindow;
				state.unsupported = new Promise(resolve => {
					const unsubscribe = state.desktop.onProjectEvent(event => {
						if (
							event.type !== 'supervisor' ||
							event.state.status !== 'unsupported'
						)
							return;
						unsubscribe();
						resolve(event.state);
					});
				});
			});
			await action();
			const state = await page.evaluate(
				() => (window as unknown as FixtureWindow).unsupported,
			);
			expect(state.status).toBe('unsupported');
			expect(state.restart.nextAttemptAt).toBeNull();
		};
		const audit = () =>
			readFileSync(path.join(path.dirname(cli), 'preflight-audit'), 'utf8')
				.trim()
				.split('\n')
				.map(
					line =>
						JSON.parse(line) as {
							kind: string;
							isolated?: boolean;
							trust?: boolean;
							session?: boolean;
						},
				);
		await unsupportedAfter(() =>
			page
				.getByRole('button', {name: 'open a project folder', exact: true})
				.click(),
		);
		expect(audit().filter(event => event.kind === 'launch')).toHaveLength(1);
		const retry = page.getByRole('button', {
			name: 'retry Nanocoder',
			exact: true,
		});
		await expect(retry).toBeEnabled();
		writeFileSync(behaviour, 'published');
		await unsupportedAfter(() => retry.click());
		expect(audit().filter(event => event.kind === 'launch')).toHaveLength(2);
		await unsupportedAfter(() => retry.click());
		expect(audit().filter(event => event.kind === 'launch')).toHaveLength(2);
		expect(
			audit().some(
				event => event.isolated === false || event.trust || event.session,
			),
		).toBe(false);
		expect(captureLaunchIdentity(runtime)).toEqual(before);
		expect(
			await app.evaluate(
				() => (globalThis as unknown as {trustPrompts: number}).trustPrompts,
			),
		).toBe(0);
		expect(
			await page.evaluate(() =>
				(window as unknown as FixtureWindow).events.some(
					event =>
						event.type === 'supervisor' && event.state.status === 'ready',
				),
			),
		).toBe(false);
	} finally {
		await app?.close();
		rmSync(work, {recursive: true, force: true});
	}
});
