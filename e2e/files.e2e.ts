import {execFileSync} from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
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
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import {visibleTextContrast} from './qa/ui-contrast';

const root = path.resolve(import.meta.dirname, '..');
let work: string;
let project: string;
let profile: string;
let app: ElectronApplication;
let page: Page;

const git = (...args: string[]) =>
	execFileSync('git', args, {
		cwd: project,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
		},
	});

const put = (name: string, content: string | Buffer) => {
	mkdirSync(path.dirname(path.join(project, name)), {recursive: true});
	writeFileSync(path.join(project, name), content);
};

async function start(options: {repository?: boolean} = {}) {
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-files-')));
	project = path.join(work, 'project');
	profile = path.join(work, 'profile');
	const fakeCli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(path.dirname(fakeCli), {recursive: true});
	mkdirSync(project);
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
	put('.fake-nanocoder', 'files');
	put('.gitignore', 'build/\n');
	put('README.md', '# demo\n');
	put('src/a.ts', 'export const a = 1;\n');
	put('src/lib/b.ts', 'export const b = 2;\n');
	put('build/out.js', 'ignored\n');
	put('data/blob.bin', Buffer.from([0, 1, 2, 3]));
	put('data/latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
	if (options.repository !== false) {
		git('-c', 'init.defaultBranch=main', 'init', '-q');
		git('config', 'core.autocrlf', 'false');
		// The agent's marker file is test scaffolding, not a change to review.
		writeFileSync(path.join(project, '.git/info/exclude'), '.fake-nanocoder\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'initial');
	}
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {
			cliPath: fakeCli,
			nodePath: process.execPath,
		}),
	});
	page = await app.firstWindow();
	await page.setViewportSize({width: 1240, height: 900});
	await app.evaluate(({dialog, shell}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (async () => ({
			response: 0,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
		const state = globalThis as unknown as {
			opened: string[];
			revealed: string[];
		};
		state.opened = [];
		state.revealed = [];
		shell.openPath = async file => {
			state.opened.push(file);
			return '';
		};
		shell.showItemInFolder = file => {
			state.revealed.push(file);
		};
	}, project);
	await page
		.getByRole('button', {name: 'open a project folder', exact: true})
		.click();
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
}

test.afterEach(async () => {
	try {
		await app?.close();
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
});

const filesButton = () =>
	page.getByRole('button', {name: 'open project files', exact: true});
const tree = () => page.getByRole('tree', {name: 'project files'});
const item = (name: string | RegExp) => tree().getByRole('treeitem', {name});
const composer = () =>
	page.getByRole('textbox', {name: 'message', exact: true});
const chips = () =>
	page.getByRole('list', {name: 'attached to your next message'});

async function openFiles() {
	await filesButton().click();
	await expect(tree()).toBeVisible();
}

async function send(text: string) {
	await composer().fill(text);
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect(page.getByText('files fixture done')).toBeVisible();
}

async function projectId(): Promise<string> {
	return page.evaluate(async () => {
		const result = await (
			window as unknown as {desktop: DesktopApi}
		).desktop.listProjects({});
		if (!result.ok) throw new Error('no projects');
		return result.value[0].id;
	});
}

test('SP-07 FILE-01 FILE-02 the tree lists one folder at a time and never shows .git', async () => {
	await start();
	await openFiles();
	await expect(item('src')).toBeVisible();
	await expect(item('README.md')).toBeVisible();
	await expect(
		tree().getByRole('treeitem', {name: '.git', exact: true}),
	).toHaveCount(0);
	await expect(item('.gitignore')).toBeVisible();
	// Nothing inside a closed folder has been listed yet.
	await expect(item('a.ts')).toHaveCount(0);
	await item('src').click();
	await expect(item('a.ts')).toBeVisible();
	await expect(item('lib')).toBeVisible();
	await expect(item('b.ts')).toHaveCount(0);
	await expect(item('src')).toHaveAttribute('aria-expanded', 'true');
	await expect(item('a.ts')).toHaveAttribute('aria-level', '2');
	await expect(item('src')).toHaveAttribute('aria-level', '1');
	// Folders come before files, and Git's ignored folders are marked.
	const names = await tree().getByRole('treeitem').allInnerTexts();
	expect(
		names
			.slice(0, 3)
			.map(name => name.replace(/[▸▾·]|\s/gu, '').replace(/,.*/u, '')),
	).toEqual(['build', 'data', 'src']);
	await expect(item(/build/)).toContainText('ignored by Git');
});

test('SP-07 FILE-04 a text file previews with highlighting, and binary and non-UTF-8 files give metadata only', async () => {
	await start();
	await openFiles();
	await item('src').click();
	await item('a.ts').click();
	const preview = page.getByRole('region', {name: 'preview of a.ts'});
	await expect(preview).toBeVisible();
	await expect(preview.locator('.cm-content')).toContainText(
		'export const a = 1;',
	);
	await expect(
		preview.getByRole('textbox', {name: 'contents of src/a.ts'}),
	).toHaveAttribute('aria-readonly', 'true');
	// The editor stays inside a shadow root, so the page keeps its strict stylesheet policy.
	await expect(preview.locator('.code-view-host')).toBeVisible();
	expect(
		await page.evaluate(() => document.head.querySelectorAll('style').length),
	).toBe(0);
	await item('data').click();
	await item('blob.bin').click();
	await expect(page.getByText('not previewed: binary file')).toBeVisible();
	await item('latin1.txt').click();
	await expect(
		page.getByText('not previewed: unsupported text encoding'),
	).toBeVisible();
	await expect(page.getByText(/Latin-1/)).toBeVisible();
	await expect(page.locator('.cm-content')).toHaveCount(0);
});

test('SP-07 FILE-11 the tree is fully operable from the keyboard with tree semantics', async () => {
	await start();
	await openFiles();
	await item('build').focus();
	await page.keyboard.press('ArrowDown');
	await expect(item('data')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(item('src')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(item('src')).toHaveAttribute('aria-expanded', 'true');
	await expect(item('lib')).toBeVisible();
	await page.keyboard.press('ArrowRight');
	await expect(item('lib')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(item('a.ts')).toBeFocused();
	await expect(item('a.ts')).toHaveCSS('outline-width', '2px');
	await page.keyboard.press('Enter');
	await expect(
		page.getByRole('region', {name: 'preview of a.ts'}),
	).toBeVisible();
	await page.keyboard.press('ArrowLeft');
	await expect(item('src')).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(item('src')).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('End');
	await expect(item('README.md')).toBeFocused();
	await page.keyboard.press('Home');
	await expect(item('build')).toBeFocused();
	// Exactly one row is in the tab order at a time (roving tabindex).
	expect(await tree().locator('[role="treeitem"][tabindex="0"]').count()).toBe(
		1,
	);
});

test('SEC-03 FILE-10 a link that leaves the project is listed as outside and cannot be opened or previewed', async () => {
	await start();
	const outside = path.join(work, 'outside');
	mkdirSync(outside);
	writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
	try {
		symlinkSync(outside, path.join(project, 'escape'), 'junction');
		symlinkSync(
			path.join(outside, 'secret.txt'),
			path.join(project, 'secret-link.txt'),
			'file',
		);
	} catch {
		test.skip(true, 'this account cannot create links');
	}
	await openFiles();
	await expect(item(/^escape/)).toContainText('outside project');
	await item(/^escape/).click();
	await item(/secret-link\.txt/).click();
	await expect(page.getByText('top secret')).toHaveCount(0);
	await expect(item(/^escape/)).not.toHaveAttribute('aria-expanded', 'true');
	// The same refusals hold when the bridge is called directly.
	const id = await projectId();
	const results = await page.evaluate(async id => {
		const files = (window as unknown as {desktop: DesktopApi}).desktop.files;
		return {
			list: await files.list({projectId: id, path: 'escape'}),
			preview: await files.preview({projectId: id, path: 'secret-link.txt'}),
			parent: await files.list({projectId: id, path: '..'}),
			absolute: await files.preview({projectId: id, path: '/etc/passwd'}),
			git: await files.list({projectId: id, path: '.git'}),
		};
	}, id);
	expect(results.list).toMatchObject({
		ok: false,
		error: {code: 'OUTSIDE_ROOT'},
	});
	expect(results.preview).toMatchObject({
		ok: true,
		value: {kind: 'metadata', reason: 'outside-project'},
	});
	expect(results.parent).toMatchObject({
		ok: false,
		error: {code: 'VALIDATION'},
	});
	expect(results.absolute).toMatchObject({
		ok: false,
		error: {code: 'VALIDATION'},
	});
	expect(results.git).toMatchObject({ok: false, error: {code: 'DENIED'}});
	expect(JSON.stringify(results)).not.toContain('top secret');
});

test('FILE-05 files changed outside the app appear without a manual refresh', async () => {
	await start();
	await openFiles();
	await expect(item('README.md')).toBeVisible();
	writeFileSync(path.join(project, 'created-outside.txt'), 'new\n');
	await expect(item('created-outside.txt')).toBeVisible();
	rmSync(path.join(project, 'created-outside.txt'));
	await expect(item('created-outside.txt')).toHaveCount(0);
	// Manual refresh always works as well.
	writeFileSync(path.join(project, 'second.txt'), 'x\n');
	await page.getByRole('button', {name: 'refresh', exact: true}).click();
	await expect(item('second.txt')).toBeVisible();
});

test('FILE-06 FILE-07 open in editor and reveal hand the contained real path to the system', async () => {
	await start();
	await openFiles();
	await item('src').click();
	await item('a.ts').click();
	const preview = page.getByRole('region', {name: 'preview of a.ts'});
	await preview.getByRole('button', {name: 'open in editor'}).click();
	await preview.getByRole('button', {name: 'reveal'}).click();
	await expect
		.poll(() =>
			app.evaluate(() => (globalThis as unknown as {opened: string[]}).opened),
		)
		.toEqual([path.join(project, 'src/a.ts')]);
	await expect
		.poll(() =>
			app.evaluate(
				() => (globalThis as unknown as {revealed: string[]}).revealed,
			),
		)
		.toEqual([path.join(project, 'src/a.ts')]);
	const refused = await page.evaluate(
		async id => {
			const files = (window as unknown as {desktop: DesktopApi}).desktop.files;
			return [
				await files.openInEditor({projectId: id, path: '../outside'}),
				await files.reveal({projectId: id, path: '/etc/hosts'}),
				await files.openInEditor({projectId: id, path: '.git/config'}),
			];
		},
		await projectId(),
	);
	for (const result of refused) expect(result.ok).toBe(false);
	expect(
		await app.evaluate(
			() => (globalThis as unknown as {opened: string[]}).opened,
		),
	).toHaveLength(1);
});

test('SP-09 FILE-08 CHAT-16 an attached file reaches Nanocoder through the checked read and is forgotten after the send', async () => {
	await start();
	await openFiles();
	await item('src').click();
	await item('a.ts').click();
	await page
		.getByRole('region', {name: 'preview of a.ts'})
		.getByRole('button', {name: 'attach to chat'})
		.click();
	await expect(chips().getByText('src/a.ts')).toBeVisible();
	// The same file is not attached twice.
	await item('a.ts').focus();
	await page.keyboard.press('Shift+Enter');
	await expect(chips().getByRole('listitem')).toHaveCount(1);
	await send('please look at this file');
	await expect(
		page.getByText('read src/a.ts: export const a = 1;'),
	).toBeVisible();
	await expect(page.getByText('attached: src/a.ts')).toBeVisible();
	await expect(chips()).toHaveCount(0);
	// Attached context is not stored with the thread.
	const stored = readdirSync(profile)
		.filter(name => name.startsWith('desktop.sqlite'))
		.map(name => readFileSync(path.join(profile, name)).toString('latin1'))
		.join('');
	expect(stored).not.toContain('export const a = 1;');
});

test('SP-09 an attachment can be removed before sending', async () => {
	await start();
	await openFiles();
	await item('README.md').click();
	await page
		.getByRole('region', {name: 'preview of README.md'})
		.getByRole('button', {name: 'attach to chat'})
		.click();
	await expect(chips().getByText('README.md')).toBeVisible();
	await page.getByRole('button', {name: 'remove README.md'}).click();
	await expect(chips()).toHaveCount(0);
	await send('nothing attached');
	await expect(page.getByText(/read README\.md/)).toHaveCount(0);
});

test('SP-08 GIT-02 GIT-03 the review lists the real work tree, including changes made outside the agent', async () => {
	await start();
	writeFileSync(
		path.join(project, 'README.md'),
		'# demo\nedited by the user\n',
	);
	put('notes.txt', 'untracked\n');
	put('src/lib/b.ts', 'export const b = 22;\n');
	git('add', 'src/lib/b.ts');
	await filesButton().click();
	await page.getByRole('tab', {name: 'review'}).click();
	const list = page.getByRole('list', {name: 'changed files'});
	await expect(list.getByRole('button', {name: /README\.md/})).toContainText(
		'unstaged modified',
	);
	await expect(list.getByRole('button', {name: /notes\.txt/})).toContainText(
		'untracked',
	);
	await expect(list.getByRole('button', {name: /b\.ts/})).toContainText(
		'staged modified',
	);
	await page.getByRole('button', {name: 'staged', exact: true}).click();
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await page.getByRole('button', {name: 'unstaged', exact: true}).click();
	await expect(list.getByRole('listitem')).toHaveCount(2);
	await page.getByRole('button', {name: 'all changes'}).click();
	await list.getByRole('button', {name: /README\.md/}).click();
	await expect(page.getByText('edited by the user')).toBeVisible();
	await expect(page.getByText(/^review is unavailable/)).toHaveCount(0);
	await expect(page.getByText(/git 2\./)).toBeVisible();
});

test('SP-08 GIT-05 GIT-04 after a turn the files its tools edited are labelled, with the real diff', async () => {
	await start();
	writeFileSync(path.join(project, 'README.md'), '# demo\nuser edit\n');
	await filesButton().click();
	await page.getByRole('tab', {name: 'review'}).click();
	await send('please edit src/a.ts now');
	const list = page.getByRole('list', {name: 'changed files'});
	await expect(list.getByRole('button', {name: /src\/a\.ts/})).toContainText(
		'touched in the last turn',
	);
	// The user's own edit is shown too, but is not claimed by the agent.
	await expect(
		list.getByRole('button', {name: /README\.md/}),
	).not.toContainText('touched');
	await page.getByRole('button', {name: 'touched this turn'}).click();
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await list.getByRole('button', {name: /src\/a\.ts/}).click();
	const lines = page.getByRole('listbox', {
		name: /unstaged changes in src\/a\.ts/,
	});
	await expect(
		lines.getByRole('option', {name: /added line 2: agent edit/}),
	).toBeVisible();
	await expect(page.getByText(/the last turn edited 1 file/)).toBeVisible();
});

test('SP-09 GIT-07 CHAT-16 a comment on selected diff lines reaches only the next prompt and is never stored', async () => {
	await start();
	await send('please edit src/a.ts now');
	await filesButton().click();
	await page.getByRole('tab', {name: 'review'}).click();
	await page
		.getByRole('list', {name: 'changed files'})
		.getByRole('button', {name: /src\/a\.ts/})
		.click();
	const lines = page.getByRole('listbox', {name: /changes in src\/a\.ts/});
	await lines.getByRole('option', {name: /unchanged line 1/}).click();
	await lines
		.getByRole('option', {name: /added line 2: agent edit/})
		.click({modifiers: ['Shift']});
	const form = page.getByRole('form', {name: 'review comment'});
	await expect(form.getByText(/lines 1 to 2/)).toBeVisible();
	const secret = 'unique-review-comment-7f3a';
	await form.getByRole('textbox').fill(`${secret}: why this change?`);
	await form.getByRole('button', {name: 'add to next message'}).click();
	await expect(chips().getByText('src/a.ts:1-2 (comment)')).toBeVisible();
	await composer().fill('please address the comment');
	await page.getByRole('button', {name: 'send', exact: true}).click();
	await expect(
		page.getByText(
			new RegExp(
				`comment received: Review comment on src/a\\.ts, lines 1-2 \\(unstaged changes\\)`,
			),
		),
	).toBeVisible();
	await expect(page.getByText(/\+agent edit/).first()).toBeVisible();
	await expect(chips()).toHaveCount(0);
	await app.close();
	const stored = readdirSync(profile)
		.filter(name => name.startsWith('desktop.sqlite'))
		.map(name => readFileSync(path.join(profile, name)).toString('latin1'))
		.join('');
	expect(stored).not.toContain(secret);
});

test('SP-09 GIT-07 a diff line range can be chosen from the keyboard', async () => {
	await start();
	await send('please edit src/a.ts now');
	await filesButton().click();
	await page.getByRole('tab', {name: 'review'}).click();
	await page
		.getByRole('list', {name: 'changed files'})
		.getByRole('button', {name: /src\/a\.ts/})
		.click();
	const lines = page.getByRole('listbox', {name: /changes in src\/a\.ts/});
	await lines.getByRole('option', {name: /unchanged line 1/}).click();
	await page.keyboard.press('Shift+ArrowDown');
	await expect(
		page.getByRole('form', {name: 'review comment'}).getByText(/lines 1 to 2/),
	).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('form', {name: 'review comment'})).toHaveCount(0);
});

test('GIT-13 a project that is not a Git repository shows review as unavailable while files still work', async () => {
	await start({repository: false});
	await filesButton().click();
	await expect(item('README.md')).toBeVisible();
	await page.getByRole('tab', {name: 'review'}).click();
	await expect(
		page.getByText('review is unavailable', {exact: true}),
	).toBeVisible();
	await expect(page.getByText(/not a Git repository/)).toBeVisible();
	await page.getByRole('tab', {name: 'files'}).click();
	await expect(item('README.md')).toBeVisible();
});

test('GIT-14 the page can only read from Git, so no destructive action is reachable', async () => {
	await start();
	await filesButton().click();
	await page.getByRole('tab', {name: 'review'}).click();
	// The proof: the review namespace is the page's only route to Git, and it
	// has two read methods. Main refuses every other Git subcommand as well
	// (source/main/git/run.spec.ts), so a new write method would fail both.
	const keys = await page.evaluate(() =>
		Object.keys(
			(window as unknown as {desktop: {review: object}}).desktop.review,
		),
	);
	expect(keys.sort()).toEqual(['diff', 'status']);
	// A smoke check only, not proof: no control is labelled with an obvious write verb.
	const labels = (await page.getByRole('button').allInnerTexts())
		.join('\n')
		.toLowerCase();
	for (const word of [
		'stage',
		'discard',
		'commit',
		'reset',
		'checkout',
		'stash',
		'push',
	])
		expect(labels, word).not.toMatch(new RegExp(`(^|\\n)${word}\\b`));
});

test('A11Y-01 the panels have no contrast gaps in either theme', async () => {
	await start();
	await send('please edit src/a.ts now');
	await openFiles();
	await item('src').click();
	await item('a.ts').click();
	for (const theme of ['dark', 'light']) {
		await page.evaluate(theme => {
			document.documentElement.dataset.theme = theme;
		}, theme);
		expect(await visibleTextContrast(page, theme)).toEqual([]);
		await page.getByRole('tab', {name: 'review'}).click();
		await page
			.getByRole('list', {name: 'changed files'})
			.getByRole('button', {name: /src\/a\.ts/})
			.click();
		await expect(page.getByRole('listbox')).toBeVisible();
		expect(await visibleTextContrast(page, theme)).toEqual([]);
		await page.getByRole('tab', {name: 'files'}).click();
	}
	expect(existsSync(project)).toBe(true);
});
