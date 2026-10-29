import {homedir} from 'node:os';
import {
	app,
	BrowserWindow,
	dialog,
	type OpenDialogOptions,
	type WebContents,
} from 'electron';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {registerHandler} from '@/main/ipc/register';
import {registerWorkspaceHandlers} from '@/main/ipc/workspace';
import type {WorkspaceServices} from '@/main/ipc/workspace-services';
import {disposeDesktop} from '@/main/lifecycle';
import {untilAborted} from '@/main/nanocoder/abort';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	cancelPromptRequest,
	cancelTechnicalTurn,
} from '@/main/nanocoder/cancel-technical-turn';
import {resolveNanocoder} from '@/main/nanocoder/runtime';
import {createLookup} from '@/main/nanocoder/runtime-lookup';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {TechnicalSessions} from '@/main/nanocoder/technical-sessions';
import type {TrustRefusal} from '@/main/nanocoder/trust';
import {confirmProjectTrust} from '@/main/projects/project-consent';
import {createProjectService} from '@/main/projects/project-service';
import {isAllowedOrigin} from '@/main/security';
import {APP_NAME} from '@/shared/app-info';
import {
	type AppInfo,
	CHANNELS,
	type ConnectResult,
	type NanocoderRuntime,
	type SessionInfo,
	type TurnEvent,
	type TurnResult,
} from '@/shared/ipc';

const runtimeDiscovery = new AbortController();
const lookupRuntime = createLookup(() =>
	resolveNanocoder({
		env: process.env,
		platform: process.platform,
		untrustedRoots:
			workspaceServices.store?.projects
				.list()
				.map(project => project.canonicalRoot) ?? [],
		signal: runtimeDiscovery.signal,
	}),
);
let supervisor: ProjectSupervisor | undefined;
let activeProjectId: string | undefined;
let session: SessionInfo | undefined;
let rendererAttachment = new AbortController();
let connecting: Promise<void> | undefined;
let rendererCleanup: Promise<void> = Promise.resolve();
let technicalSessions: TechnicalSessions | undefined;
let appOrigins: readonly string[] = [];
let workspaceServices: WorkspaceServices = {};
let unsubscribeProjectEvents: (() => void) | undefined;

// Only windows showing the app get events; the renderer never sees the IPC event object.
function sendEvent(event: TurnEvent): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (
			!window.webContents.isDestroyed() &&
			isAllowedOrigin(window.webContents.getURL(), appOrigins)
		) {
			window.webContents.send(CHANNELS.nanocoderEvent, event);
		}
	}
}

async function nanocoderRuntime(): Promise<NanocoderRuntime> {
	const resolution = await lookupRuntime();
	if (!resolution.ok) {
		throw new IpcFailure(resolution.code, resolution.message);
	}
	return resolution.runtime;
}

async function chooseProjectRoot(): Promise<string | undefined> {
	const options: OpenDialogOptions = {
		title: 'Open a project folder',
		properties: ['openDirectory'],
	};
	const window = BrowserWindow.getFocusedWindow();
	const picked = window
		? await dialog.showOpenDialog(window, options)
		: await dialog.showOpenDialog(options);
	const [folder] = picked.filePaths;
	return picked.canceled || !folder ? undefined : folder;
}

// A native dialog in main, so the renderer can never grant trust on the user's behalf.
async function confirmTrust(
	refusal: TrustRefusal,
	root: string,
): Promise<boolean> {
	return confirmProjectTrust({
		root,
		refusal,
		signal: rendererAttachment.signal,
		ask: async options => {
			const window = BrowserWindow.getFocusedWindow();
			const {response} = window
				? await dialog.showMessageBox(window, options)
				: await dialog.showMessageBox(options);
			return response;
		},
	});
}

async function connect(): Promise<ConnectResult> {
	const {signal} = rendererAttachment;
	await untilAborted(rendererCleanup, signal);
	signal.throwIfAborted();
	const currentSupervisor = supervisor;
	const sessions = technicalSessions;
	const projects = workspaceServices.projects;
	if (
		runtimeDiscovery.signal.aborted ||
		!currentSupervisor ||
		!sessions ||
		!projects
	) {
		throw new IpcFailure(
			'AGENT_UNAVAILABLE',
			'The desktop cannot start a project now',
		);
	}
	if (connecting) {
		throw new IpcFailure('BUSY', 'Already connecting to Nanocoder', true);
	}
	let settle!: () => void;
	const attempt = new Promise<void>(resolve => {
		settle = resolve;
	});
	connecting = attempt;
	try {
		const selected = await untilAborted(
			Promise.resolve(projects.addProject({})),
			signal,
		);
		if (selected.status === 'cancelled') return selected;
		signal.throwIfAborted();
		if (runtimeDiscovery.signal.aborted)
			throw new IpcFailure('AGENT_UNAVAILABLE', 'The desktop is shutting down');
		activeProjectId = undefined;
		session = undefined;
		activeProjectId = selected.project.id;
		const opened = await untilAborted(
			Promise.resolve(projects.openProject({projectId: selected.project.id})),
			signal,
		);
		if (opened.status !== 'opened') return opened;
		const project = opened.project;
		const connection = currentSupervisor.getConnection(project.id);
		const prepared = await untilAborted(
			sessions.prepare(project, signal),
			signal,
		);
		signal.throwIfAborted();
		if (currentSupervisor.getConnection(project.id) !== connection)
			throw new IpcFailure(
				'AGENT_UNAVAILABLE',
				'The project process changed while connecting',
			);
		session = prepared;
		currentSupervisor.replayState(project.id);
		return {status: 'connected', agent: connection.agent, session};
	} catch (error) {
		if (error instanceof NanocoderFailure)
			throw new IpcFailure(error.code, error.message);
		throw error;
	} finally {
		if (connecting === attempt) connecting = undefined;
		settle();
	}
}

async function sendPrompt({text}: {text: string}): Promise<TurnResult> {
	if (!supervisor || !activeProjectId || !session) {
		throw new IpcFailure('AGENT_UNAVAILABLE', 'No project is open');
	}
	return supervisor
		.prompt(activeProjectId, session.id, text)
		.catch((error: unknown) => {
			if (error instanceof NanocoderFailure) {
				throw new IpcFailure(error.code, error.message);
			}
			throw error;
		});
}

function answerPermission({
	id,
	optionId,
}: {
	id: string;
	optionId: string;
}): null {
	if (
		!supervisor ||
		!activeProjectId ||
		!session ||
		!supervisor.answerPermission(activeProjectId, session.id, id, optionId)
	) {
		throw new IpcFailure(
			'NOT_FOUND',
			'That permission request is no longer waiting',
		);
	}
	return null;
}

export function closeNanocoder(): Promise<void> {
	runtimeDiscovery.abort();
	rendererAttachment.abort(
		new IpcFailure('AGENT_UNAVAILABLE', 'The desktop is shutting down'),
	);
	return disposeDesktop({
		unsubscribe: unsubscribeProjectEvents,
		cancelPermissions: () => {},
		supervisor: workspaceServices.supervisor,
		store: workspaceServices.store,
	});
}

function watchRenderer(contents: WebContents): void {
	let attached = false;
	const detach = () => {
		if (!attached || !technicalSessions) return;
		const attempt = connecting;
		rendererAttachment.abort(
			new IpcFailure('AGENT_UNAVAILABLE', 'The app renderer detached'),
		);
		rendererAttachment = new AbortController();
		activeProjectId = undefined;
		session = undefined;
		rendererCleanup = Promise.allSettled([
			rendererCleanup,
			technicalSessions.detach(
				runtimeDiscovery.signal.aborted
					? []
					: (workspaceServices.store?.projects.list() ?? []),
			),
			attempt,
		]).then(() => {});
	};
	contents.on('did-finish-load', () => {
		attached = isAllowedOrigin(contents.getURL(), appOrigins);
	});
	contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
		if (isMainFrame && !isInPlace) {
			detach();
			attached = isAllowedOrigin(url, appOrigins);
		}
	});
	contents.on('render-process-gone', detach);
	contents.once('destroyed', detach);
}

export function registerIpcHandlers(
	allowedOrigins: readonly string[],
	services: WorkspaceServices = {},
): void {
	appOrigins = allowedOrigins;
	supervisor = services.supervisor
		? undefined
		: new ProjectSupervisor({
				resolveRuntime: (root, signal) =>
					resolveNanocoder({
						env: process.env,
						platform: process.platform,
						untrustedRoots: [root],
						signal,
					}),
				clientInfo: {
					name: 'nanocoder-desktop',
					title: APP_NAME,
					version: app.getVersion(),
				},
				homeDir: homedir(),
				confirmTrust,
			});
	workspaceServices = {
		...services,
		supervisor: services.supervisor ?? supervisor,
		projects:
			services.projects ??
			(services.store && supervisor
				? createProjectService({
						store: services.store,
						chooseRoot: chooseProjectRoot,
						supervisor,
						signal: () => rendererAttachment.signal,
					})
				: undefined),
	};
	technicalSessions = supervisor
		? new TechnicalSessions(supervisor)
		: undefined;
	app.on('web-contents-created', (_event, contents) => watchRenderer(contents));
	for (const window of BrowserWindow.getAllWindows())
		watchRenderer(window.webContents);
	registerWorkspaceHandlers(registerHandler, allowedOrigins, workspaceServices);
	unsubscribeProjectEvents = workspaceServices.supervisor?.subscribe(event => {
		if (event.type === 'supervisor' && event.state.status === 'untrusted') {
			const store = workspaceServices.store;
			const project = store?.projects.get(event.projectId);
			if (project?.trusted) store?.projects.save({...project, trusted: false});
		}
		if (
			event.type === 'turn' &&
			event.projectId === activeProjectId &&
			event.threadId === session?.id
		) {
			for (const turn of event.events) sendEvent(turn);
		}
		for (const window of BrowserWindow.getAllWindows()) {
			if (
				!window.webContents.isDestroyed() &&
				isAllowedOrigin(window.webContents.getURL(), appOrigins)
			) {
				window.webContents.send(CHANNELS.projectEvent, event);
			}
		}
	});
	registerHandler(
		CHANNELS.getAppInfo,
		z.strictObject({}),
		(): AppInfo => ({name: APP_NAME, version: app.getVersion()}),
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.getNanocoderRuntime,
		z.strictObject({}),
		nanocoderRuntime,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.connectNanocoder,
		z.strictObject({}),
		connect,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.sendPrompt,
		z.strictObject({text: z.string().trim().min(1).max(100_000)}),
		sendPrompt,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.answerPermission,
		z.strictObject({id: z.string().max(64), optionId: z.string().max(200)}),
		answerPermission,
		allowedOrigins,
	);
	registerHandler(
		CHANNELS.cancelPrompt,
		cancelPromptRequest,
		() => cancelTechnicalTurn(supervisor, activeProjectId, session),
		allowedOrigins,
	);
}
