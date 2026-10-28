import {
	copyFileSync,
	existsSync,
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
		args: ['.'],
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
		`Connected to nanocoder 9.9.9 over ACP protocol version 1 in ${root}`,
	);
	await expect(agent).toContainText('Session fake-session in normal mode');
	await expect(agent.locator('dt:has-text("Resume sessions") + dd')).toHaveText(
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
	await expect(alert).toContainText('Not opened. Directory');
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
	).toContainText('Session fake-session in normal mode');
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
	await expect(card.getByRole('button')).toHaveText(['Allow', 'Deny']);
	// Nothing answers for the user: the turn is still open.
	await expect(page.getByText('Turn ended')).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Send'})).toBeDisabled();
	await card.getByRole('button', {name: 'Deny'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});

test('allow once: the tool runs and the turn ends', async () => {
	await startTurn('allow-once');
	await page
		.getByRole('region', {name: 'Permission request'})
		.getByRole('button', {name: 'Allow'})
		.click();

	const conversation = page.getByRole('list', {name: 'Conversation'});
	await expect(conversation).toContainText('You: Run the command');
	await expect(conversation).toContainText('Nanocoder: Working on it.');
	await expect(conversation).toContainText(
		'Tool execute_bash: echo hi: completed',
	);
	await expect(conversation).toContainText('Tool ran.');
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
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
		'Tool execute_bash: echo hi: failed',
	);
	await expect(conversation).toContainText('Tool denied.');
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
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
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});

test('shows every waiting request, so none is left unanswerable', async () => {
	await startTurn('two-requests', 'two-tools');
	await expect(cards()).toHaveCount(2);
	await expect(cards().first()).toContainText('execute_bash: echo call_1');
	await expect(cards().last()).toContainText('execute_bash: echo call_2');

	await cards().last().getByRole('button', {name: 'Deny'}).click();
	await expect(cards()).toHaveCount(1);
	await expect(cards().first()).toContainText('echo call_1');
	await expect(page.getByText('Turn ended')).toHaveCount(0);

	await cards().first().getByRole('button', {name: 'Allow'}).click();
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
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
	await expect(page.getByText('Turn ended: end_turn')).toBeVisible();
});

test('validates a prompt', async () => {
	const empty = await bridge('sendPrompt', '   ');
	const wrongType = await bridge('sendPrompt', {text: 'x'});
	expect(empty.error?.code).toBe('VALIDATION');
	expect(wrongType.error?.code).toBe('VALIDATION');
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
