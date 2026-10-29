import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
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
import type {
	IpcResult,
	WorkspaceMethod,
	WorkspaceRequests,
	WorkspaceValues,
} from '@/shared/ipc';

let work: string;
let app: ElectronApplication;
let page: Page;

async function launch() {
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: {
			...process.env,
			NANOCODER_DESKTOP_CLI: path.join(work, 'nanocoder/dist/cli.js'),
			NANOCODER_DESKTOP_NODE: process.execPath,
		},
	});
	page = await app.firstWindow();
}

test.beforeEach(async () => {
	work = realpathSync.native(
		mkdtempSync(path.join(tmpdir(), 'nd-project-e2e-')),
	);
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
	await launch();
});

test.afterEach(async () => {
	await app.close();
	rmSync(work, {recursive: true, force: true});
});

function call<K extends WorkspaceMethod>(
	method: K,
	request: WorkspaceRequests[K],
): Promise<IpcResult<WorkspaceValues[K]>> {
	return page.evaluate(
		({method, request}) => {
			const api = (window as unknown as {desktop: DesktopApi}).desktop;
			return (api[method] as (request: unknown) => Promise<unknown>)(request);
		},
		{method, request},
	) as Promise<IpcResult<WorkspaceValues[K]>>;
}

async function picker(folder?: string, response = 1) {
	await app.evaluate(
		({dialog}, {folder, response}) => {
			const state = globalThis as {
				projectPrompts?: unknown[];
				projectPickerCalls?: number;
			};
			state.projectPrompts = [];
			state.projectPickerCalls = 0;
			dialog.showOpenDialog = (async () => {
				state.projectPickerCalls = (state.projectPickerCalls ?? 0) + 1;
				return {canceled: !folder, filePaths: folder ? [folder] : []};
			}) as typeof dialog.showOpenDialog;
			dialog.showMessageBox = (async (...args: unknown[]) => {
				(globalThis as {projectPrompts?: unknown[]}).projectPrompts?.push(
					args.at(-1),
				);
				return {response, checkboxChecked: false};
			}) as typeof dialog.showMessageBox;
		},
		{folder, response},
	);
}

async function add(root: string) {
	await picker(root);
	const result = await call('addProject', {});
	expect(result).toMatchObject({ok: true, value: {status: 'selected'}});
	if (!result.ok || result.value.status !== 'selected')
		throw new Error('Expected a selected project');
	return result.value.project;
}

test('a canonical non-Git project selected in main remains in recents after restart (CHAT-01)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	const link = path.join(work, 'alias');
	symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
	const project = await add(link);
	expect(project).toMatchObject({
		canonicalRoot: root,
		sessionCwd: root,
		displayName: 'project',
		trusted: false,
		defaultMode: 'normal',
	});
	await app.close();
	await launch();
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [project],
	});
});

test('workspace opening uses the native execution summary before granting trust (DEC-30)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(path.join(root, '.nanocoder/plugins'), {recursive: true});
	writeFileSync(path.join(root, '.fake-nanocoder'), 'untrusted');
	writeFileSync(
		path.join(root, '.nanocoder/plugins/example.mjs'),
		'throw new Error("must not execute in desktop");',
	);
	const project = await add(root);
	await picker(root, 0);
	expect(await call('openProject', {projectId: project.id})).toMatchObject({
		ok: true,
		value: {
			status: 'opened',
			project: {trusted: true},
			supervisor: {status: 'ready', activeThreadId: null},
		},
	});
	const prompts = await app.evaluate(
		() =>
			(
				globalThis as {
					projectPrompts?: Array<{detail?: string; defaultId?: number}>;
				}
			).projectPrompts ?? [],
	);
	expect(prompts).toHaveLength(1);
	expect(prompts[0].detail).toContain(root);
	expect(prompts[0].detail).toContain('plugins: 1');
	expect(prompts[0].defaultId).toBe(1);
	expect(existsSync(path.join(root, '.fake-trusted'))).toBe(true);
});

test('native refusal leaves the project untrusted and renderer start remains denied (SEC-17)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'untrusted');
	const project = await add(root);
	expect(await call('openProject', {projectId: project.id})).toMatchObject({
		ok: true,
		value: {status: 'untrusted'},
	});
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{trusted: false}],
	});
	expect(await call('startProject', {projectId: project.id})).toMatchObject({
		ok: false,
		error: {code: 'DENIED'},
	});
	expect(existsSync(path.join(root, '.fake-trusted'))).toBe(false);
});

test('locating a moved project preserves its id and requires fresh trust (CHAT-01)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	const project = await add(root);
	const moved = path.join(work, 'moved');
	renameSync(root, moved);
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{availability: 'missing'}],
	});
	await picker(moved);
	expect(await call('locateProject', {projectId: project.id})).toMatchObject({
		ok: true,
		value: {
			status: 'selected',
			project: {
				id: project.id,
				canonicalRoot: moved,
				sessionCwd: moved,
				trusted: false,
			},
		},
	});
});

test('the existing folder action also records a recent project (CHAT-02)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	await picker(root);
	const result = await page.evaluate(() =>
		(window as unknown as {desktop: DesktopApi}).desktop.connectNanocoder(),
	);
	expect(result).toMatchObject({ok: true, value: {status: 'connected'}});
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{canonicalRoot: root, trusted: true}],
	});
});

test('workspace and existing folder actions reuse the same canonical project process (CHAT-01)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	const project = await add(root);
	expect(await call('openProject', {projectId: project.id})).toMatchObject({
		ok: true,
		value: {status: 'opened'},
	});
	await picker(root);
	expect(
		await page.evaluate(() =>
			(window as unknown as {desktop: DesktopApi}).desktop.connectNanocoder(),
		),
	).toMatchObject({ok: true, value: {status: 'connected'}});
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{id: project.id, canonicalRoot: root}],
	});
});

test('a recent-project action opens by id without reopening the folder picker (CHAT-02)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'untrusted');
	const project = await add(root);
	await picker(root, 0);
	await page.reload();
	const recent = page.getByRole('region', {name: 'recent projects'});
	await expect(recent).toBeVisible();
	await recent.getByRole('button', {name: 'open project', exact: true}).click();
	await expect(page.getByLabel('project trust feedback')).toContainText(
		'project ready',
	);
	expect(
		await app.evaluate(
			() => (globalThis as {projectPickerCalls?: number}).projectPickerCalls,
		),
	).toBe(0);
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{id: project.id, trusted: true}],
	});
});

test('missing recent folders explain the disabled open action and offer locate (CHAT-01)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	const project = await add(root);
	const moved = path.join(work, 'moved');
	renameSync(root, moved);
	await picker(moved);
	await page.reload();
	const recent = page.getByRole('region', {name: 'recent projects'});
	await expect(
		recent.getByRole('button', {name: 'open project', exact: true}),
	).toBeDisabled();
	await expect(recent).toContainText('folder missing');
	await recent
		.getByRole('button', {name: 'locate project', exact: true})
		.click();
	await expect(
		recent.getByRole('button', {name: 'open moved', exact: true}),
	).toBeEnabled();
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{id: project.id, canonicalRoot: moved}],
	});
});

test('cancelling the recent-project picker leaves the list unchanged and reports cancellation (CHAT-01)', async () => {
	await picker();
	const recent = page.getByRole('region', {name: 'recent projects'});
	await expect(recent).toBeVisible();
	await recent
		.getByRole('button', {name: 'add project folder', exact: true})
		.click();
	await expect(page.getByLabel('project trust feedback')).toContainText(
		'no folder selected',
	);
	expect(await call('listProjects', {})).toMatchObject({ok: true, value: []});
});

test('a direct supervisor trust refusal revokes the previously recorded desktop trust (SEC-17)', async () => {
	const root = path.join(work, 'project');
	mkdirSync(root);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'untrusted');
	const project = await add(root);
	await picker(root, 0);
	expect(await call('openProject', {projectId: project.id})).toMatchObject({
		ok: true,
		value: {status: 'opened'},
	});
	await call('stopProject', {projectId: project.id});
	rmSync(path.join(root, '.fake-trusted'));
	await picker(root, 1);
	expect(await call('startProject', {projectId: project.id})).toMatchObject({
		ok: true,
		value: {status: 'untrusted'},
	});
	expect(await call('listProjects', {})).toMatchObject({
		ok: true,
		value: [{trusted: false}],
	});
});

test('opening a recent project hides the legacy composer for the previous project (CHAT-02)', async () => {
	const first = path.join(work, 'first-project');
	const second = path.join(work, 'second-project');
	mkdirSync(first);
	mkdirSync(second);
	await add(first);
	await add(second);
	await picker(first);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(page.getByRole('textbox', {name: 'message'})).toBeVisible();
	const recent = page.getByRole('region', {name: 'recent projects'});
	await recent
		.getByRole('button', {name: 'open second-project', exact: true})
		.click();
	await expect(page.getByLabel('project trust feedback')).toContainText(
		'project ready: second-project',
	);
	await expect(page.getByRole('textbox', {name: 'message'})).toHaveCount(0);
	await expect(page.locator('.ui-badge--acp-ready')).toBeVisible();
	await expect(recent.locator('[aria-current="true"]')).toContainText(
		'second-project',
	);
	await expect(
		page
			.locator('[data-shell-slot="stream-tools"]')
			.getByLabel('project trust feedback'),
	).toBeVisible();
	await page.emulateMedia({reducedMotion: 'reduce'});
	for (const [theme, color] of [
		['dark', 'rgb(230, 230, 234)'],
		['light', 'rgb(27, 33, 50)'],
	]) {
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		await expect(
			recent
				.locator('[aria-current="true"] .recent-project-description > p')
				.first(),
		).toHaveCSS('color', color);
	}
});

test('opening a folder through the legacy action refreshes the active recent project (CHAT-02)', async () => {
	const root = path.join(work, 'current-project');
	mkdirSync(root);
	await picker(root);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(page.getByRole('textbox', {name: 'message'})).toBeVisible();
	await expect(
		page
			.getByRole('region', {name: 'recent projects'})
			.locator('[aria-current="true"]'),
	).toContainText('current-project');
});
