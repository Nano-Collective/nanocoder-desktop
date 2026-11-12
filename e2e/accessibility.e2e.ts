import {execFileSync} from 'node:child_process';
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
import {
	type AxNode,
	focusTrap,
	interactiveCount,
	unnamedInteractive,
} from './qa/accessibility';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';

const root = path.resolve(import.meta.dirname, '..');
let work: string;
let app: ElectronApplication;
let page: Page;

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
		},
	});

test.beforeEach(async () => {
	work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-a11y-')));
	const project = path.join(work, 'project');
	const cli = path.join(work, 'nanocoder', 'dist', 'cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	mkdirSync(path.join(project, 'src'), {recursive: true});
	writeFileSync(
		path.join(work, 'nanocoder', 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync(
		path.join(
			root,
			'source/main/nanocoder/fixtures/fake-control-nanocoder.mjs',
		),
		cli,
	);
	writeFileSync(path.join(project, 'README.md'), '# demo\n');
	writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
	git(project, '-c', 'init.defaultBranch=main', 'init', '-q');
	git(project, 'config', 'core.autocrlf', 'false');
	writeFileSync(path.join(project, '.git/info/exclude'), '.fake-nanocoder\n');
	git(project, 'add', '-A');
	git(project, 'commit', '-q', '-m', 'initial');
	writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 2;\n');
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
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
	await expect(
		page.getByRole('textbox', {name: 'message', exact: true}),
	).toBeEnabled();
});

test.afterEach(async () => {
	try {
		await app?.close();
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
});

async function axNodes(): Promise<AxNode[]> {
	const session = await page.context().newCDPSession(page);
	try {
		const {nodes} = await session.send('Accessibility.getFullAXTree');
		return nodes as AxNode[];
	} finally {
		await session.detach();
	}
}

const positiveTabindex = () =>
	page.evaluate(() =>
		[...document.querySelectorAll('[tabindex]')]
			.filter(element => Number(element.getAttribute('tabindex')) > 0)
			.map(element => element.outerHTML.slice(0, 80)),
	);

const inTerminal = () =>
	page.evaluate(
		() =>
			document.activeElement?.getAttribute('aria-label') ===
			'your terminal input',
	);

// Tab through the page. The terminal passes Tab to its shell by design, so focus that enters it
// leaves with the key the terminal documents (TERM-11).
const focusSequence = async (steps: number, key = 'Tab') => {
	const seen: string[] = [];
	for (let step = 0; step < steps; step++) {
		await page.keyboard.press(key);
		if (await inTerminal()) await page.keyboard.press('Control+Shift+Tab');
		seen.push(
			await page.evaluate(() => {
				const element = document.activeElement;
				if (!element || element === document.body) return 'body';
				const label =
					element.getAttribute('aria-label') ??
					element.textContent?.trim().slice(0, 30) ??
					'';
				return `${element.tagName}:${label}:${[...document.querySelectorAll(element.tagName)].indexOf(element)}`;
			}),
		);
	}
	return seen;
};

const areas: Array<{
	name: string;
	open(): Promise<void>;
	close(): Promise<void>;
}> = [
	{
		name: 'chat',
		open: async () => {},
		close: async () => {},
	},
	{
		name: 'files',
		open: async () => {
			await page.getByRole('button', {name: 'open project files'}).click();
			await expect(page.getByRole('tab', {name: 'files'})).toBeVisible();
		},
		close: async () => {},
	},
	{
		name: 'review',
		open: async () => {
			await page.getByRole('tab', {name: 'review'}).click();
			await expect(page.getByRole('tab', {name: 'review'})).toHaveAttribute(
				'aria-selected',
				'true',
			);
		},
		close: async () => {},
	},
	{
		name: 'browser',
		open: async () => {
			await page.getByRole('tab', {name: 'browser'}).click();
			await expect(page.getByRole('tab', {name: 'browser'})).toHaveAttribute(
				'aria-selected',
				'true',
			);
		},
		close: async () => {},
	},
	{
		name: 'terminal',
		open: async () => {
			await page.getByRole('button', {name: 'open terminal'}).click();
			await expect(
				page.getByRole('button', {name: 'close terminal panel'}),
			).toBeVisible();
		},
		close: async () => {},
	},
];

test('A11Y-03 every control in chat, files, review, browser and terminal exposes a name, and no tab index forces a different focus order (A11Y-02)', async () => {
	for (const area of areas) {
		await area.open();
		const nodes = await axNodes();
		expect(
			interactiveCount(nodes),
			`${area.name} exposes no controls at all, so the sweep proves nothing`,
		).toBeGreaterThan(5);
		const unnamed = unnamedInteractive(nodes);
		expect(unnamed, `unnamed controls in ${area.name}`).toEqual([]);
		expect(await positiveTabindex(), `tabindex in ${area.name}`).toEqual([]);
		await area.close();
	}
});

test('A11Y-01 the keyboard can move through and out of chat, files, review, browser and terminal with no trap', async () => {
	for (const area of areas) {
		await area.open();
		const forward = await focusSequence(40);
		expect(
			focusTrap(forward),
			`Tab stuck in ${area.name}: ${forward.slice(0, 6)}`,
		).toBe(false);
		const backward = await focusSequence(40, 'Shift+Tab');
		expect(focusTrap(backward), `Shift+Tab stuck in ${area.name}`).toBe(false);
	}
});

test('A11Y-01 TERM-11 the terminal documents its escape key on screen and to assistive technology, and the key works', async () => {
	await page.getByRole('button', {name: 'open terminal'}).click();
	await expect(
		page.getByText('ctrl+shift+tab leaves terminal focus'),
	).toBeVisible();
	const start = page.getByRole('button', {name: 'start terminal'});
	if (await start.isVisible()) await start.click();
	const input = page.getByRole('textbox', {name: 'your terminal input'});
	await expect(input).toBeVisible();
	await expect(input).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+Tab');
	await input.focus();
	await page.keyboard.press('Control+Shift+Tab');
	await expect(input).not.toBeFocused();
	await expect(
		page.getByRole('button', {name: 'focus your terminal'}),
	).toBeFocused();
});

test('A11Y-03 the sweep reports an unnamed control when one is present, so a pass means something', async () => {
	expect(unnamedInteractive(await axNodes())).toEqual([]);
	await page.evaluate(() => {
		const unnamed = document.createElement('button');
		unnamed.setAttribute('data-fixture', 'unnamed');
		document.body.append(unnamed);
		const field = document.createElement('input');
		field.type = 'text';
		document.body.append(field);
	});
	expect(unnamedInteractive(await axNodes()).sort()).toEqual([
		'button',
		'textbox',
	]);
});

test('A11Y-02 the tab index rule reports a positive tab index when one is present', async () => {
	expect(await positiveTabindex()).toEqual([]);
	await page.evaluate(() => {
		const forced = document.createElement('button');
		forced.textContent = 'forced';
		forced.setAttribute('tabindex', '3');
		document.body.append(forced);
	});
	expect(await positiveTabindex()).toHaveLength(1);
});

for (const opener of [
	'command palette',
	'keyboard shortcuts',
	'switch project',
	'thread actions',
]) {
	test(`A11Y-02 A11Y-03 the ${opener} dialog names every control, closes on Escape and returns focus to what opened it`, async () => {
		const trigger = page.getByRole('button', {name: opener, exact: true});
		await trigger.focus();
		await trigger.press('Enter');
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		const nodes = await axNodes();
		expect(unnamedInteractive(nodes)).toEqual([]);
		expect(await positiveTabindex()).toEqual([]);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});
}

test('A11Y-03 the shell exposes one main landmark, and every region and navigation landmark has a name', async () => {
	await page.getByRole('button', {name: 'open project files'}).click();
	const nodes = await axNodes();
	const landmarks = (role: string) =>
		nodes.filter(node => !node.ignored && node.role?.value === role);
	expect(landmarks('main')).toHaveLength(1);
	for (const role of ['region', 'navigation', 'complementary', 'form']) {
		for (const node of landmarks(role))
			expect(
				String(node.name?.value ?? '').trim(),
				`a ${role} landmark has no name`,
			).not.toBe('');
	}
});
