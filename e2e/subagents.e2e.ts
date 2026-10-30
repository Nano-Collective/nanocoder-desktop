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
import {DatabaseSync} from 'node:sqlite';
import {
	type ElectronApplication,
	expect,
	type Page,
	test,
} from '@playwright/test';
import {build} from 'vite';
import {electron} from './qa/electron';
import {qaEnvironment} from './qa/environment';
import type {subagentHarness} from './qa/subagent-harness';
import {visibleTextContrast} from './qa/ui-contrast';

const root = path.resolve(import.meta.dirname, '..');
const work = realpathSync.native(
	mkdtempSync(path.join(tmpdir(), 'nd-subagents-')),
);
let app: ElectronApplication;
let page: Page;
type HarnessWindow = {
	subagentFixture: {subagentHarness: typeof subagentHarness};
};

test.beforeAll(async () => {
	const cli = path.join(work, 'nanocoder/dist/cli.js');
	mkdirSync(path.dirname(cli), {recursive: true});
	copyFileSync(
		path.join(root, 'source/main/nanocoder/fixtures/fake-nanocoder.mjs'),
		cli,
	);
	writeFileSync(
		path.join(work, 'nanocoder/package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	app = await electron.launch({
		cwd: root,
		args: [root, `--user-data-dir=${path.join(work, 'profile')}`],
		env: qaEnvironment(process.env, {cliPath: cli, nodePath: process.execPath}),
	});
	page = await app.firstWindow();
	expect(page.url()).toMatch(/^app:\/\/renderer\//);
});

test.describe('fc01-shaped delegation cards', () => {
	const cards = () => page.locator('.subagent-run-card');
	const input = () => page.getByRole('textbox', {name: 'message', exact: true});
	const stop = () =>
		page.getByRole('button', {
			name: /stop turn:.*entire turn and all subagents/,
		});
	async function prompt(text: string) {
		await input().fill(text);
		await input().press('Enter');
	}
	test.beforeAll(async () => {
		const project = path.join(work, 'project');
		mkdirSync(project);
		writeFileSync(path.join(project, '.fake-nanocoder'), 'subagents');
		await app.evaluate(({dialog}, folder) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [folder],
			})) as typeof dialog.showOpenDialog;
		}, project);
		await page
			.getByRole('button', {name: 'open a project folder', exact: true})
			.click();
		await expect(input()).toBeEnabled();
	});

	test('flat cards retain task and reported progress with one attributed approval queue (SUB-01/02/03)', async () => {
		await prompt('fixture approval');
		await expect(cards()).toHaveCount(1);
		await expect(cards().last()).toContainText('inspect fixture');
		await expect(cards().last()).toContainText('1.2k tokens');
		await expect(cards().last()).toContainText('3 tools (read_file)');
		await expect(cards().last()).toContainText('depth not reported');
		await expect(page.getByRole('alertdialog')).toHaveCount(1);
		await expect(page.getByRole('alertdialog')).toContainText(
			'execute_bash fixture (explore)',
		);
		await expect(page.getByRole('alertdialog')).toContainText(
			'may still fail afterwards',
		);
		await expect(page.getByRole('alertdialog')).toBeFocused();
		await expect(cards().last()).not.toContainText('private fixture task');
		await stop().click();
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(cards().last()).toContainText('interrupted');
	});

	test('approved inner tool is not shown as successful when the delegation fails (SUB-03)', async () => {
		await prompt('fixture failure');
		await expect(cards().first()).toContainText('interrupted');
		await expect(page.getByRole('alertdialog')).toHaveCount(1);
		await page
			.getByRole('alertdialog')
			.getByRole('button', {name: 'Allow'})
			.click();
		await expect(
			page.getByText('turn ended: end_turn', {exact: true}),
		).toBeVisible();
		await expect(cards().last()).toContainText('failed');
		await expect(
			page
				.locator('.gate-message-tool')
				.filter({hasText: 'execute_bash fixture (explore)'})
				.last(),
		).toContainText('approved · execution result not reported');
		await expect(stop()).toHaveCount(0);
	});

	test('stop without approval preserves the editable running draft (SUB-04)', async () => {
		await prompt('fixture no approval');
		await expect(stop()).toHaveCount(1);
		await input().fill('unsent fixture draft');
		await expect(
			page.getByRole('button', {name: 'send', exact: true}),
		).toBeDisabled();
		await stop().focus();
		await stop().press('Enter');
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
		await expect(input()).toHaveValue('unsent fixture draft');
		await expect(input()).toBeFocused();
		await expect(cards().last()).toContainText('interrupted');
	});

	test('same-name cards never claim ambiguous approvals and one stop closes every pending request (SUB-03/04)', async () => {
		await prompt('fixture two approvals');
		await expect(stop()).toHaveCount(2);
		await expect(page.getByRole('alertdialog')).toHaveCount(2);
		const names = await cards().evaluateAll(elements =>
			elements.map(element => element.getAttribute('aria-label')),
		);
		expect(new Set(names).size).toBe(names.length);
		expect(names.slice(-2)).toEqual([
			`subagent run ${names.length - 1} of ${names.length}: explore`,
			`subagent run ${names.length} of ${names.length}: explore`,
		]);
		await expect(
			page.getByRole('region', {
				name: 'permission request 1 of 2',
				exact: true,
			}),
		).toHaveCount(1);
		await expect(
			page.getByRole('region', {
				name: 'permission request 2 of 2',
				exact: true,
			}),
		).toHaveCount(1);
		for (const dialog of await page.getByRole('alertdialog').all())
			await expect(dialog).toContainText('parent run not reported');
		await expect(
			cards().filter({has: page.getByRole('alertdialog')}),
		).toHaveCount(0);
		await stop().first().click();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(stop()).toHaveCount(0);
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
	});

	test('thin delegation safely falls back and source bounds are not settings (SUB-06/07)', async () => {
		const retained = await cards().allTextContents();
		await prompt('fixture fallback');
		await expect(cards()).toHaveCount(retained.length + 1);
		await expect(cards().last()).toContainText('child details not available');
		await expect(cards().last()).toContainText(
			'source bounds: depth 2, batch 5',
		);
		await expect(cards().last()).toContainText('elapsed not reported');
		await expect(cards().last().getByRole('combobox')).toHaveCount(0);
		await cards()
			.last()
			.getByRole('button', {
				name: /stop turn:.*entire turn and all subagents/,
			})
			.click();
		await expect(
			page.getByText('turn interrupted: cancelled', {exact: true}),
		).toBeVisible();
		for (const [index, text] of retained.entries())
			await expect(cards().nth(index)).toHaveText(text);
	});

	for (const theme of ['dark', 'light'] as const) {
		test(`card focus, wrapping and reduced motion in ${theme} at three widths (U.7)`, async () => {
			await page.evaluate(theme => {
				document.documentElement.dataset.theme = theme;
			}, theme);
			const previousCards = await cards().count();
			await prompt('fixture no approval');
			await expect(cards()).toHaveCount(previousCards + 1);
			const runningCard = cards().nth(previousCards);
			await expect(runningCard).toContainText('3 tools (read_file)');
			const runningStop = runningCard.getByRole('button', {
				name: /stop turn:.*entire turn and all subagents/,
			});
			await expect(runningStop).toBeEnabled();
			await page.emulateMedia({reducedMotion: 'reduce'});
			for (const width of [1240, 1020, 840]) {
				await page.setViewportSize({width, height: 900});
				await runningStop.focus();
				await expect(runningStop).toBeFocused();
				await expect(runningStop).toHaveCSS('outline-width', '2px');
				const box = await runningCard.boundingBox();
				expect(box?.width).toBeGreaterThan(200);
				expect(
					await runningCard.evaluate(
						element => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				expect(await visibleTextContrast(page, theme)).toEqual([]);
			}
			await runningStop.press('Enter');
			await expect(
				page.getByText('turn interrupted: cancelled', {exact: true}),
			).toBeVisible();
			await page.emulateMedia({reducedMotion: 'no-preference'});
			await page.setViewportSize({width: 1240, height: 900});
		});
	}

	test('SUB-05 remains unwired rather than pretending cards are durable', async () => {
		const profile = await app.evaluate(({app}) => app.getPath('userData'));
		const db = new DatabaseSync(path.join(profile, 'desktop.sqlite'), {
			readOnly: true,
		});
		try {
			expect(
				db.prepare('SELECT count(*) AS count FROM agent_run').get()?.count,
			).toBe(0);
		} finally {
			db.close();
		}
	});
});

test.afterAll(async () => {
	await app?.close();
	rmSync(work, {recursive: true, force: true});
});

test.describe('passive card stop owner', () => {
	test.beforeAll(async () => {
		const result = await build({
			configFile: false,
			logLevel: 'silent',
			define: {'process.env.NODE_ENV': JSON.stringify('production')},
			resolve: {alias: {'@': path.join(root, 'source')}},
			build: {
				write: false,
				minify: false,
				lib: {
					entry: path.join(root, 'e2e/qa/subagent-harness.ts'),
					name: 'subagentFixture',
					formats: ['iife'],
				},
			},
		});
		const outputs = Array.isArray(result) ? result : [result];
		const code = outputs
			.flatMap(output => ('output' in output ? output.output : []))
			.filter(chunk => chunk.type === 'chunk')
			.map(chunk => chunk.code)
			.join('\n');
		if (!code) throw new Error('Missing subagent component fixture');
		await page.evaluate(code);
	});
	test.afterEach(async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.dispose(),
		);
	});

	test('stop captures the clicked owner, not a replacement callback (SUB-04)', async () => {
		await page.evaluate(() => {
			const harness = (window as unknown as HarnessWindow).subagentFixture
				.subagentHarness;
			harness.render('original-owner');
			document
				.querySelector<HTMLButtonElement>('#subagent-stop-fixture button')
				?.click();
			harness.render('replacement-owner');
		});
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						window as unknown as HarnessWindow
					).subagentFixture.subagentHarness.calls(),
				),
			)
			.toEqual(['original-owner']);
	});

	test('two card stops share one pending operation (SUB-04)', async () => {
		await page.evaluate(() => {
			const harness = (window as unknown as HarnessWindow).subagentFixture
				.subagentHarness;
			harness.render('same-owner');
			document
				.querySelectorAll<HTMLButtonElement>('#subagent-stop-fixture button')
				.forEach(button => button.click());
		});
		const buttons = page.locator('#subagent-stop-fixture button');
		await expect(buttons).toHaveCount(2);
		await expect(buttons.first()).toBeDisabled();
		await expect(buttons.last()).toBeDisabled();
		expect(
			await page.evaluate(() =>
				(
					window as unknown as HarnessWindow
				).subagentFixture.subagentHarness.calls(),
			),
		).toEqual(['same-owner']);
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.release(),
		);
		await expect(buttons.first()).toBeEnabled();
	});

	test('failed stop is announced and re-enables the cards (SUB-04)', async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render('failed-owner', true),
		);
		await page.locator('#subagent-stop-fixture button').first().click();
		await expect(
			page.locator('#subagent-stop-fixture').getByRole('alert'),
		).toHaveText('could not stop the turn. try again.');
		await expect(
			page.locator('#subagent-stop-fixture button').first(),
		).toBeEnabled();
	});

	test('adding a card retains existing card nodes and the focused stop (A11Y-01/02)', async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render('original-owner'),
		);
		const cards = page.locator('#subagent-stop-fixture .subagent-run-card');
		await expect(cards).toHaveCount(2);
		const original = await cards.elementHandles();
		const focusedStop = cards.nth(1).getByRole('button');
		await focusedStop.focus();
		await expect(focusedStop).toBeFocused();
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render(
				'original-owner',
				false,
				'append',
			),
		);
		await expect(cards).toHaveCount(3);
		for (const [index, element] of original.entries()) {
			expect(
				await element.evaluate(
					(node, index) =>
						node.isConnected &&
						node ===
							document.querySelectorAll(
								'#subagent-stop-fixture .subagent-run-card',
							)[index],
					index,
				),
			).toBe(true);
		}
		await expect(focusedStop).toBeFocused();
	});

	for (const activation of ['click', 'Enter'] as const) {
		test(`a settled card cannot ${activation} the new turn's stop while awaiting its user boundary (SUB-04 A11Y-02)`, async () => {
			await page.evaluate(() =>
				(
					window as unknown as HarnessWindow
				).subagentFixture.subagentHarness.render('previous-owner'),
			);
			const card = page
				.locator('#subagent-stop-fixture .subagent-run-card')
				.nth(1);
			const button = await card.getByRole('button').elementHandle();
			if (!button) throw new Error('Missing live fixture stop');
			await button.focus();
			await page.evaluate(() =>
				(
					window as unknown as HarnessWindow
				).subagentFixture.subagentHarness.render(
					'current-owner',
					false,
					'admitting',
				),
			);
			if (activation === 'click')
				await button.evaluate(node => {
					if (node instanceof HTMLButtonElement) node.click();
				});
			else await page.keyboard.press('Enter');
			expect(
				await page.evaluate(() =>
					(
						window as unknown as HarnessWindow
					).subagentFixture.subagentHarness.calls(),
				),
			).toEqual([]);
			await expect(card.getByRole('button')).toHaveCount(0);
			await expect(card).toBeFocused();
		});
	}

	test('a focused stop yields to its same named card when its turn ends and another card arrives (A11Y-01/02)', async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render('previous-owner'),
		);
		const cards = page.locator('#subagent-stop-fixture .subagent-run-card');
		const card = cards.nth(1);
		const original = await card.elementHandle();
		await card.getByRole('button').focus();
		await expect(card.getByRole('button')).toBeFocused();
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render(
				'current-owner',
				false,
				'next-turn',
			),
		);
		await expect(cards).toHaveCount(3);
		expect(
			await original?.evaluate(
				node =>
					node.isConnected &&
					node ===
						document.querySelectorAll(
							'#subagent-stop-fixture .subagent-run-card',
						)[1],
			),
		).toBe(true);
		await expect(card.getByRole('button')).toHaveCount(0);
		await expect(card).toHaveAccessibleName('subagent run 2 of 3: explore');
		await expect(card).toBeFocused();
		await expect(cards.last().getByRole('button')).toBeEnabled();
	});

	test('settling a card never takes focus from another control (A11Y-02)', async () => {
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render('previous-owner'),
		);
		const composer = page.getByRole('textbox', {name: 'message', exact: true});
		await composer.focus();
		await expect(composer).toBeFocused();
		await page.evaluate(() =>
			(
				window as unknown as HarnessWindow
			).subagentFixture.subagentHarness.render(
				'current-owner',
				false,
				'next-turn',
			),
		);
		await expect(composer).toBeFocused();
	});
});
