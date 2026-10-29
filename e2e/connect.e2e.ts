import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
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
import type {ProjectEvent} from '@/shared/ipc';

const work = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'nd-e2e-')));
const fakeCli = path.join(work, 'nanocoder', 'dist', 'cli.js');
let app: ElectronApplication;
let page: Page;

function project(name: string, mode?: string): string {
	const dir = path.join(work, name);
	mkdirSync(dir);
	if (mode) writeFileSync(path.join(dir, '.fake-nanocoder'), mode);
	return dir;
}

interface Prompt {
	title?: string;
	message?: string;
	detail?: string;
}

// Stubs both native dialogs: the folder picker, and the trust prompt with the given button.
async function openFolder(folder: string, trustButton = 1): Promise<void> {
	await app.evaluate(
		({dialog}, [picked, button]) => {
			const state = globalThis as {trustPrompts?: unknown[]};
			state.trustPrompts = [];
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [picked],
			})) as typeof dialog.showOpenDialog;
			dialog.showMessageBox = (async (...args: unknown[]) => {
				state.trustPrompts?.push(args.at(-1));
				return {response: button, checkboxChecked: false};
			}) as typeof dialog.showMessageBox;
		},
		[folder, trustButton] as const,
	);
	await page.getByRole('button', {name: 'Open a project folder'}).click();
	await expect(
		page.getByRole('button', {name: 'Open a project folder'}),
	).toBeEnabled();
}

const trustPrompts = () =>
	app.evaluate(
		() => (globalThis as {trustPrompts?: Prompt[]}).trustPrompts ?? [],
	);

test.beforeAll(async () => {
	mkdirSync(path.dirname(fakeCli), {recursive: true});
	writeFileSync(
		path.join(work, 'nanocoder', 'package.json'),
		JSON.stringify({
			name: '@nanocollective/nanocoder',
			version: '9.9.9',
			type: 'module',
			bin: {nanocoder: 'dist/cli.js'},
		}),
	);
	copyFileSync('source/main/nanocoder/fixtures/fake-nanocoder.mjs', fakeCli);
	app = await electron.launch({
		args: ['.', `--user-data-dir=${path.join(work, 'profile')}`],
		env: {
			...process.env,
			NANOCODER_DESKTOP_CLI: fakeCli,
			NANOCODER_DESKTOP_NODE: process.execPath,
		},
	});
	page = await app.firstWindow();
	// Records the id of every permission request the app is shown, through the real bridge.
	await page.evaluate(() => {
		const seen: string[] = [];
		const state = window as unknown as {
			permissionIds: string[];
			desktop: {
				onNanocoderEvent(
					listener: (event: {type: string; request?: {id: string}}) => void,
				): void;
			};
		};
		state.permissionIds = seen;
		state.desktop.onNanocoderEvent(event => {
			if (event.type === 'permission' && event.request) {
				seen.push(event.request.id);
			}
		});
	});
});

test.afterAll(async () => {
	await app.close();
	rmSync(work, {recursive: true, force: true});
});

test('shows the Nanocoder it will launch', async () => {
	await expect(page.getByText(`Nanocoder 9.9.9 at ${fakeCli}`)).toBeVisible();
});

interface Bridge {
	sendPrompt(text: unknown): Promise<{ok: boolean; error?: {code: string}}>;
	answerPermission(
		id: unknown,
		optionId: unknown,
	): Promise<{ok: boolean; error?: {code: string}}>;
}

const bridge = <K extends keyof Bridge>(
	method: K,
	...args: Parameters<Bridge[K]>
) =>
	page.evaluate(
		([name, values]) =>
			(
				window as unknown as {
					desktop: Record<string, (...a: unknown[]) => unknown>;
				}
			).desktop[name](...values),
		[method, args] as const,
	) as ReturnType<Bridge[K]>;

test('refuses a prompt before any project is open', async () => {
	const result = await bridge('sendPrompt', 'Hello');
	expect(result.ok).toBe(false);
	expect(result.error?.code).toBe('AGENT_UNAVAILABLE');
});

test('opens a trusted folder in normal mode without asking', async () => {
	const root = project('trusted');
	await openFolder(root);
	const agent = page.getByRole('region', {name: 'Connected agent'});
	await expect(agent).toContainText(
		`connected to nanocoder 9.9.9 over ACP protocol version 1 in ${root}`,
	);
	await expect(agent).toContainText('session fake-session in normal mode');
	await expect(agent.locator('dt:has-text("resume sessions") + dd')).toHaveText(
		'yes',
	);
	expect(await trustPrompts()).toEqual([]);
});

test("asks with Nanocoder's reason, and shows its message when the user says no", async () => {
	const root = project('refused', 'untrusted');
	await openFolder(root);
	const [prompt] = await trustPrompts();
	expect(prompt.title).toBe('Trust this folder?');
	// The home folder is redacted to ~, and on Windows the temp folder sits inside it.
	expect(prompt.message).toMatch(/^Directory /);
	expect(prompt.message).toContain(
		`${path.sep}${path.basename(root)} is not trusted.`,
	);
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('not opened. Directory');
	await expect(alert).toContainText('is not trusted.');
	await expect(alert).not.toContainText('--trust-directory');
	await expect(alert).not.toContainText('NANOCODER_TRUST_DIRECTORY');
	expect(existsSync(path.join(root, '.fake-trusted'))).toBe(false);
});

test('trusts the folder through Nanocoder when the user agrees, then opens it', async () => {
	const root = project('accepted', 'untrusted');
	await openFolder(root, 0);
	expect(await trustPrompts()).toHaveLength(1);
	expect(existsSync(path.join(root, '.fake-trusted'))).toBe(true);
	await expect(
		page.getByRole('region', {name: 'Connected agent'}),
	).toContainText('session fake-session in normal mode');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('reports a second refusal without asking again', async () => {
	await openFolder(project('stubborn', 'refuse'), 0);
	expect(await trustPrompts()).toHaveLength(1);
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('is not trusted');
	await expect(alert).not.toContainText('unrelated warning');
});

async function sendMessage(): Promise<void> {
	await page.getByLabel('Message').fill('Run the command');
	await page.getByRole('button', {name: 'Send'}).click();
}

async function startTurn(name: string, mode?: string): Promise<void> {
	await openFolder(project(name, mode));
	await sendMessage();
}

const permissionIds = () =>
	page.evaluate(
		() => (window as unknown as {permissionIds: string[]}).permissionIds,
	);

const cards = () => page.getByRole('region', {name: 'Permission request'});

test("shows the permission request with Nanocoder's options and waits for the user", async () => {
	await startTurn('wait');
	const card = page.getByRole('region', {name: 'Permission request'});
	await expect(card).toContainText('execute_bash: echo hi');
	await expect(card.getByRole('button')).toHaveCount(2);
	await expect(card.getByRole('button').first()).toHaveAccessibleName('Allow');
	await expect(card.getByRole('button').last()).toHaveAccessibleName('Deny');
	// Nothing answers for the user: the turn is still open.
	await expect(page.getByText('turn ended')).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Send'})).toBeDisabled();
	await card.getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
});

test('allow once: the tool runs and the turn ends', async () => {
	await startTurn('allow-once');
	await page
		.getByRole('region', {name: 'Permission request'})
		.getByRole('button', {name: 'Allow'})
		.click();

	const conversation = page.getByRole('list', {name: 'Conversation'});
	await expect(conversation).toContainText('you: Run the command');
	await expect(conversation).toContainText('Nanocoder: Working on it.');
	await expect(conversation).toContainText(
		'tool execute_bash: echo hi: completed',
	);
	await expect(conversation).toContainText('Tool ran.');
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
	await expect(
		page.getByRole('region', {name: 'Permission request'}),
	).toHaveCount(0);
});

test('reject once: the tool is marked failed and the turn goes on', async () => {
	await startTurn('reject-once');
	await page
		.getByRole('region', {name: 'Permission request'})
		.getByRole('button', {name: 'Deny'})
		.click();

	const conversation = page.getByRole('list', {name: 'Conversation'});
	await expect(conversation).toContainText(
		'tool execute_bash: echo hi: failed',
	);
	await expect(conversation).toContainText('Tool denied.');
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
});

test('only an option Nanocoder offered can answer a waiting request', async () => {
	await startTurn('refusals');
	await expect(cards()).toBeVisible();
	const live = (await permissionIds()).at(-1) ?? '';
	expect(live).toMatch(/^permission-\d+$/);

	// The live request, with an option Nanocoder did not offer: refused, and still waiting.
	const unoffered = await bridge('answerPermission', live, 'allow_always');
	expect(unoffered.ok).toBe(false);
	expect(unoffered.error?.code).toBe('NOT_FOUND');
	await expect(cards()).toBeVisible();

	// A request that was never issued, and a malformed call.
	const unknown = await bridge('answerPermission', 'permission-9999', 'allow');
	const malformed = await bridge('answerPermission', 1, ['allow']);
	expect(unknown.error?.code).toBe('NOT_FOUND');
	expect(malformed.error?.code).toBe('VALIDATION');
	await expect(cards()).toBeVisible();

	// The same live request still accepts an option it offered.
	const offered = await bridge('answerPermission', live, 'allow');
	expect(offered.ok).toBe(true);
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
});

test('shows every waiting request, so none is left unanswerable', async () => {
	await startTurn('two-requests', 'two-tools');
	await expect(cards()).toHaveCount(2);
	await expect(cards().first()).toContainText('execute_bash: echo call_1');
	await expect(cards().last()).toContainText('execute_bash: echo call_2');

	await cards().last().getByRole('button', {name: 'Deny'}).click();
	await expect(cards()).toHaveCount(1);
	await expect(cards().first()).toContainText('echo call_1');
	await expect(page.getByText('turn ended')).toHaveCount(0);

	await cards().first().getByRole('button', {name: 'Allow'}).click();
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
	await expect(page.getByRole('list', {name: 'Conversation'})).toContainText(
		'Both answered.',
	);
	await expect(cards()).toHaveCount(0);
});

test('opening another project is not blocked by a turn left open', async () => {
	await startTurn('left-open');
	await expect(cards()).toBeVisible();

	await openFolder(project('next-project'));
	await expect(cards()).toHaveCount(0);
	await sendMessage();

	await expect(cards()).toBeVisible();
	await expect(page.getByText('already working')).toHaveCount(0);
	await cards().getByRole('button', {name: 'Allow'}).click();
	await expect(page.getByText('turn ended: end_turn')).toBeVisible();
});

test('validates a prompt', async () => {
	const empty = await bridge('sendPrompt', '   ');
	const wrongType = await bridge('sendPrompt', {text: 'x'});
	expect(empty.error?.code).toBe('VALIDATION');
	expect(wrongType.error?.code).toBe('VALIDATION');
});

test('conversation and tool text never enters the desktop database', async () => {
	await openFolder(project('privacy'));
	const marker = 'fixture-private-prompt-not-for-storage';
	await page.getByLabel('Message').fill(marker);
	await page.getByRole('button', {name: 'Send'}).click();
	await cards().getByRole('button', {name: 'Allow'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
	await expect(page.getByRole('list', {name: 'Conversation'})).toContainText(
		marker,
	);
	const profile = path.join(work, 'profile');
	const files = readdirSync(profile).filter(name =>
		/^desktop\.sqlite(?:-(?:wal|shm))?$/.test(name),
	);
	expect(files).toContain('desktop.sqlite');
	for (const name of files) {
		const bytes = readFileSync(path.join(profile, name));
		for (const text of [
			marker,
			'Working on it.',
			'execute_bash: echo hi',
			'Tool ran.',
		]) {
			expect(bytes.includes(text)).toBe(false);
		}
	}
});

test('two project processes keep simultaneous turns, events and approvals separate', async () => {
	await page.evaluate(() => {
		const state = window as unknown as {
			desktop: DesktopApi;
			scopedEvents: ProjectEvent[];
		};
		state.scopedEvents = [];
		state.desktop.onProjectEvent(event => state.scopedEvents.push(event));
	});
	const first = project('concurrent-a');
	const second = project('concurrent-b');
	await openFolder(first);
	await page.getByLabel('Message').fill('First project only');
	await page.getByRole('button', {name: 'Send'}).click();
	await expect(cards()).toBeVisible();
	const firstPermission = (await permissionIds()).at(-1) ?? '';
	await openFolder(second);
	await page.getByLabel('Message').fill('Second project only');
	await page.getByRole('button', {name: 'Send'}).click();
	await expect(cards()).toBeVisible();
	const secondPermission = (await permissionIds()).at(-1) ?? '';
	expect(secondPermission).not.toBe(firstPermission);
	expect(
		(await bridge('answerPermission', firstPermission, 'allow')).error?.code,
	).toBe('NOT_FOUND');
	await expect(
		page.getByRole('list', {name: 'Conversation'}),
	).not.toContainText('First project only');
	const states = await page.evaluate(async () => {
		const state = window as unknown as {
			desktop: DesktopApi;
			scopedEvents: ProjectEvent[];
		};
		const ids = [...new Set(state.scopedEvents.map(e => e.projectId))];
		return Promise.all(
			ids.map(projectId => state.desktop.getSupervisorState({projectId})),
		);
	});
	expect(states).toHaveLength(2);
	for (const state of states) {
		expect(state.ok).toBe(true);
		if (state.ok) {
			expect(state.value.status).toBe('ready');
			expect(state.value.activeThreadId).toBe('fake-session');
		}
	}
	await cards().getByRole('button', {name: 'Allow'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
	await openFolder(first);
	await expect(cards()).toBeVisible();
	await expect(page.getByRole('list', {name: 'Conversation'})).toContainText(
		'First project only',
	);
	await expect(
		page.getByRole('list', {name: 'Conversation'}),
	).not.toContainText('Second project only');
	await cards().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
	await expect(page.getByRole('list', {name: 'Conversation'})).toContainText(
		'Tool denied.',
	);
	await expect(
		page.getByRole('list', {name: 'Conversation'}),
	).not.toContainText('Tool ran.');
	await openFolder(second);
	await expect(page.getByRole('list', {name: 'Conversation'})).toContainText(
		'Tool ran.',
	);
	await expect(
		page.getByRole('list', {name: 'Conversation'}),
	).not.toContainText('Tool denied.');
	const events = await page.evaluate(
		() => (window as unknown as {scopedEvents: ProjectEvent[]}).scopedEvents,
	);
	for (const projectId of new Set(events.map(e => e.projectId))) {
		const turns = events.filter(
			e => e.type === 'turn' && e.projectId === projectId,
		);
		expect(turns.map(e => e.sequence)).toEqual(
			turns.map((_, index) => index + 1),
		);
	}
});

test('a version below the minimum is refused with a clear upgrade message', async () => {
	await openFolder(project('old-agent', 'old-version'));
	await expect(page.getByRole('alert')).toContainText(
		'Nanocoder 1.31.0 is below the minimum 1.32.0',
	);
	await expect(page.getByRole('alert')).toContainText('Upgrade Nanocoder');
	await expect(page.getByLabel('Message')).toHaveCount(0);
});

test('an older accepted version shows a reason for every disabled feature', async () => {
	await openFolder(project('minimum-agent', 'minimum-no-gates'));
	const features = page.getByRole('region', {name: 'Nanocoder features'});
	await expect(features.locator('dd')).toHaveCount(9);
	for (const entry of await features.locator('dd').allTextContents()) {
		expect(entry).toMatch(/^unavailable: .+/);
	}
	await expect(features).toContainText(
		'Nanocoder did not advertise session/resume',
	);
	await expect(features).toContainText('safe probe');
	await expect(features.getByRole('status')).toContainText(
		'Compatibility is unverified',
	);
});

test('the native-picked root is used to refuse a project-local runtime override', async () => {
	await openFolder(work);
	await expect(page.getByRole('alert')).toContainText(
		'Refusing a Nanocoder inside the project folder',
	);
	await expect(page.getByLabel('Message')).toHaveCount(0);
});

async function recordRecoveryProjects(): Promise<void> {
	await page.evaluate(() => {
		const state = window as unknown as {
			desktop: DesktopApi;
			recoveryEvents: ProjectEvent[];
		};
		state.recoveryEvents = [];
		state.desktop.onProjectEvent(event => state.recoveryEvents.push(event));
	});
}

async function recoveryProjectId(root: string): Promise<string> {
	return page.evaluate(root => {
		const events = (window as unknown as {recoveryEvents: ProjectEvent[]})
			.recoveryEvents;
		const event = events.find(
			event => event.type === 'supervisor' && event.state.agent?.root === root,
		);
		if (!event) throw new Error('Missing project state');
		return event.projectId;
	}, root);
}

test('a failed cached resume closes its process and the next open prepares a fresh session', async () => {
	await recordRecoveryProjects();
	const root = project('resume-clean-retry');
	await openFolder(root);
	const projectId = await recoveryProjectId(root);
	const stopped = await page.evaluate(
		projectId =>
			(window as unknown as {desktop: DesktopApi}).desktop.stopProject({
				projectId,
			}),
		projectId,
	);
	expect(stopped.ok).toBe(true);
	writeFileSync(path.join(root, '.fake-nanocoder'), 'missing-session');
	await openFolder(root);
	await expect(page.getByRole('alert')).toContainText(
		'Nanocoder no longer has this session',
	);
	await expect(page.getByLabel('Message')).toHaveCount(0);
	const state = await page.evaluate(
		projectId =>
			(window as unknown as {desktop: DesktopApi}).desktop.getSupervisorState({
				projectId,
			}),
		projectId,
	);
	expect(state.ok && state.value.status).toBe('stopped');
	await openFolder(root);
	await expect(
		page.getByRole('region', {name: 'Connected agent'}),
	).toContainText('Session fake-session in normal mode');
	await sendMessage();
	await expect(cards()).toBeVisible();
	await cards().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});

test('reloading during approval cancels hidden requests and leaves a usable session on reopen', async () => {
	await recordRecoveryProjects();
	const root = project('reload-pending', 'two-tools');
	await openFolder(root);
	const projectId = await recoveryProjectId(root);
	await sendMessage();
	await expect(cards()).toHaveCount(2);
	const stale = (await permissionIds()).at(-1) ?? '';
	await page.reload();
	await expect
		.poll(async () => {
			const state = await page.evaluate(
				projectId =>
					(
						window as unknown as {desktop: DesktopApi}
					).desktop.getSupervisorState({projectId}),
				projectId,
			);
			return state.ok && state.value.status;
		})
		.toBe('stopped');
	expect((await bridge('answerPermission', stale, 'allow')).error?.code).toBe(
		'NOT_FOUND',
	);
	await openFolder(root);
	await expect(cards()).toHaveCount(0);
	await sendMessage();
	await expect(cards()).toHaveCount(2);
	await cards().first().getByRole('button', {name: 'Deny'}).click();
	await cards().first().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('closing and reopening the macOS window cancels hidden approval state', async () => {
	test.skip(
		process.platform !== 'darwin',
		'Closing the last window quits on other platforms',
	);
	await recordRecoveryProjects();
	const root = project('window-reopen-pending');
	await openFolder(root);
	const projectId = await recoveryProjectId(root);
	await sendMessage();
	await expect(cards()).toBeVisible();
	await page.close();
	const opened = app.waitForEvent('window');
	await app.evaluate(({app}) => {
		app.emit('activate');
	});
	page = await opened;
	await expect
		.poll(async () => {
			const state = await page.evaluate(
				projectId =>
					(
						window as unknown as {desktop: DesktopApi}
					).desktop.getSupervisorState({projectId}),
				projectId,
			);
			return state.ok && state.value.status;
		})
		.toBe('stopped');
	await openFolder(root);
	await sendMessage();
	await expect(cards()).toBeVisible();
	await cards().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});

test('reload during new or resumed mode preparation frees the latch before another folder opens', async () => {
	for (const resume of [false, true]) {
		await recordRecoveryProjects();
		const root = project(
			`reload-mode-${resume}`,
			resume ? undefined : 'slow-mode',
		);
		if (resume) {
			await openFolder(root);
			const projectId = await recoveryProjectId(root);
			expect(
				(
					await page.evaluate(
						projectId =>
							(window as unknown as {desktop: DesktopApi}).desktop.stopProject({
								projectId,
							}),
						projectId,
					)
				).ok,
			).toBe(true);
			writeFileSync(path.join(root, '.fake-nanocoder'), 'slow-mode');
		}
		await app.evaluate(({dialog}, root) => {
			dialog.showOpenDialog = (async () => ({
				canceled: false,
				filePaths: [root],
			})) as typeof dialog.showOpenDialog;
		}, root);
		await page.getByRole('button', {name: 'Open a project folder'}).click();
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						window as unknown as {recoveryEvents: ProjectEvent[]}
					).recoveryEvents.some(
						event =>
							event.type === 'turn' &&
							event.events.some(
								item =>
									item.type === 'text' && item.text.includes('mode waiting'),
							),
					),
				),
			)
			.toBe(true);
		const projectId = await recoveryProjectId(root);
		expect((await bridge('sendPrompt', 'not ready')).error?.code).toBe(
			'AGENT_UNAVAILABLE',
		);
		await page.reload();
		const other = project(`reload-mode-other-${resume}`);
		await openFolder(other);
		await expect(
			page.getByRole('region', {name: 'Connected agent'}),
		).toContainText(other);
		const state = await page.evaluate(
			projectId =>
				(window as unknown as {desktop: DesktopApi}).desktop.getSupervisorState(
					{projectId},
				),
			projectId,
		);
		expect(state.ok && state.value.status).toBe('stopped');
		writeFileSync(path.join(root, '.fake-nanocoder'), 'ok');
		await openFolder(root);
		await expect(
			page.getByRole('region', {name: 'Connected agent'}),
		).toContainText(root);
		await sendMessage();
		await expect(cards()).toBeVisible();
		await cards().getByRole('button', {name: 'Deny'}).click();
		await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
	}
});

test('idle reconnect replays all feature reasons and the version warning before a prompt', async () => {
	const root = project('reload-idle-gates', 'minimum-no-gates');
	await openFolder(root);
	const features = () => page.getByRole('region', {name: 'Nanocoder features'});
	await expect(features().locator('dd')).toHaveCount(9);
	const reasons = await features().locator('dd').allTextContents();
	await page.reload();
	await recordRecoveryProjects();
	await openFolder(root);
	await expect(features().locator('dd')).toHaveText(reasons);
	for (const reason of reasons) expect(reason).toMatch(/^unavailable: .+/);
	await expect(features().getByRole('status')).toContainText(
		'Compatibility is unverified',
	);
	await expect(page.getByLabel('Message')).toBeEmpty();
	const states = await page.evaluate(() =>
		(window as unknown as {recoveryEvents: ProjectEvent[]}).recoveryEvents
			.filter(event => event.type === 'supervisor')
			.map(event => event.state.status),
	);
	expect(states).toEqual(['ready']);
	await expect(page.getByText('Turn ended: end_turn')).toHaveCount(0);
});

test('a detached folder picker cannot hold the latch or reopen its late selection', async () => {
	const late = project('reload-picker-late');
	await app.evaluate(({dialog}) => {
		const state = globalThis as {
			pickerEntered?: boolean;
			releasePicker?: (value: {canceled: boolean; filePaths: string[]}) => void;
		};
		state.pickerEntered = false;
		dialog.showOpenDialog = (() => {
			state.pickerEntered = true;
			return new Promise(resolve => {
				state.releasePicker = resolve;
			});
		}) as typeof dialog.showOpenDialog;
	});
	await page.getByRole('button', {name: 'Open a project folder'}).click();
	await expect
		.poll(() =>
			app.evaluate(
				() => (globalThis as {pickerEntered?: boolean}).pickerEntered,
			),
		)
		.toBe(true);
	await page.reload();
	const replacement = project('reload-picker-replacement');
	await openFolder(replacement);
	await app.evaluate((_electron, root) => {
		(
			globalThis as {
				releasePicker?: (value: {
					canceled: boolean;
					filePaths: string[];
				}) => void;
			}
		).releasePicker?.({canceled: false, filePaths: [root]});
	}, late);
	await expect(
		page.getByRole('region', {name: 'Connected agent'}),
	).toContainText(replacement);
	await sendMessage();
	await expect(cards()).toBeVisible();
	await cards().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});

test('a detached trust dialog cannot hold the latch or grant its late confirmation', async () => {
	const late = project('reload-trust-late', 'untrusted');
	await app.evaluate(({dialog}, root) => {
		const state = globalThis as {
			trustEntered?: boolean;
			releaseTrust?: (value: {
				response: number;
				checkboxChecked: boolean;
			}) => void;
		};
		state.trustEntered = false;
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [root],
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (() => {
			state.trustEntered = true;
			return new Promise(resolve => {
				state.releaseTrust = resolve;
			});
		}) as typeof dialog.showMessageBox;
	}, late);
	await page.getByRole('button', {name: 'Open a project folder'}).click();
	await expect
		.poll(() =>
			app.evaluate(() => (globalThis as {trustEntered?: boolean}).trustEntered),
		)
		.toBe(true);
	await page.reload();
	const replacement = project('reload-trust-replacement');
	await openFolder(replacement);
	await app.evaluate(() => {
		(
			globalThis as {
				releaseTrust?: (value: {
					response: number;
					checkboxChecked: boolean;
				}) => void;
			}
		).releaseTrust?.({response: 0, checkboxChecked: false});
	});
	await expect(
		page.getByRole('region', {name: 'Connected agent'}),
	).toContainText(replacement);
	await sendMessage();
	await expect(cards()).toBeVisible();
	await cards().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
	expect(existsSync(path.join(late, '.fake-trusted'))).toBe(false);
});

test('a second reload cancels an open still queued behind bounded process cleanup', async () => {
	await recordRecoveryProjects();
	const root = project('reload-queued-cleanup', 'ignore-shutdown');
	await openFolder(root);
	const projectId = await recoveryProjectId(root);
	await sendMessage();
	await expect(cards()).toBeVisible();
	const late = project('reload-queued-late');
	await app.evaluate(({dialog}, root) => {
		const state = globalThis as {queuedPickerCalls?: number};
		state.queuedPickerCalls = 0;
		dialog.showOpenDialog = (async () => {
			state.queuedPickerCalls = (state.queuedPickerCalls ?? 0) + 1;
			return {canceled: false, filePaths: [root]};
		}) as typeof dialog.showOpenDialog;
	}, late);
	await page.reload();
	const state = await page.evaluate(projectId => {
		const {desktop} = window as unknown as {desktop: DesktopApi};
		void desktop.connectNanocoder();
		return desktop.getSupervisorState({projectId});
	}, projectId);
	expect(state.ok && state.value.status).toBe('stopping');
	await page.reload();
	await expect
		.poll(
			async () => {
				const state = await page.evaluate(
					projectId =>
						(
							window as unknown as {desktop: DesktopApi}
						).desktop.getSupervisorState({projectId}),
					projectId,
				);
				return state.ok && state.value.status;
			},
			{timeout: 15_000},
		)
		.toBe('stopped');
	expect(
		await app.evaluate(
			() => (globalThis as {queuedPickerCalls?: number}).queuedPickerCalls,
		),
	).toBe(0);
	const replacement = project('reload-queued-replacement');
	await openFolder(replacement);
	await expect(
		page.getByRole('region', {name: 'Connected agent'}),
	).toContainText(replacement);
	await sendMessage();
	await expect(cards()).toBeVisible();
	await cards().getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});
