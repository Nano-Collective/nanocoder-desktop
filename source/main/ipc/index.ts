import {writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {
	app,
	BrowserWindow,
	dialog,
	type OpenDialogOptions,
	type WebContents,
} from 'electron';
import {z} from 'zod';
import {createWorkspaceControls} from '@/main/controls/workspace-controls';
import {confirmYolo} from '@/main/controls/yolo-consent';
import {IpcFailure} from '@/main/ipc/handle-request';
import {registerHandler} from '@/main/ipc/register';
import {registerTerminalHandlers} from '@/main/ipc/terminal';
import {registerWorkspaceHandlers} from '@/main/ipc/workspace';
import type {WorkspaceServices} from '@/main/ipc/workspace-services';
import {disposeDesktop} from '@/main/lifecycle';
import {untilAborted} from '@/main/nanocoder/abort';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {DiagnosticsExporter} from '@/main/nanocoder/diagnostics';
import {resolveNanocoder} from '@/main/nanocoder/runtime';
import {createLookup} from '@/main/nanocoder/runtime-lookup';
import {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import type {TrustRefusal} from '@/main/nanocoder/trust';
import {confirmProjectTrust} from '@/main/projects/project-consent';
import {createProjectService} from '@/main/projects/project-service';
import {isAllowedOrigin} from '@/main/security';
import {TerminalService} from '@/main/terminal/terminal-service';
import {createUtilityPtyHost} from '@/main/terminal/utility-host';
import {createThreadService} from '@/main/threads/thread-service';
import {APP_NAME} from '@/shared/app-info';
import {
	type AppInfo,
	CHANNELS,
	type ConnectResult,
	type NanocoderRuntime,
	type ProjectEvent,
	type ProjectInfo,
} from '@/shared/ipc';
import {TERMINAL_CHANNELS, type TerminalEvent} from '@/shared/terminal';

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
let rendererAttachment = new AbortController();
let connecting: Promise<void> | undefined;
let rendererCleanup: Promise<void> = Promise.resolve();
let threads: ReturnType<typeof createThreadService> | undefined;
let controlRuntime: ReturnType<typeof createWorkspaceControls> | undefined;
let appOrigins: readonly string[] = [];
let workspaceServices: WorkspaceServices = {};
let unsubscribeProjectEvents: (() => void) | undefined;
let terminal: TerminalService | undefined;

function availableControls() {
	if (!controlRuntime)
		throw new IpcFailure('UNAVAILABLE', 'The project controls are unavailable');
	return controlRuntime;
}

function invalidateControls() {
	for (const project of workspaceServices.store?.projects.list() ?? [])
		controlRuntime?.invalidate(project.id);
}

function stopProject(projectId: string) {
	if (!supervisor)
		throw new IpcFailure('AGENT_UNAVAILABLE', 'The desktop cannot stop now');
	const stopping = supervisor.stop(projectId);
	controlRuntime?.invalidate(projectId, stopping);
	return stopping;
}

// Only windows showing the app get events; the renderer never sees the IPC event object.
function sendProjectEvent(event: ProjectEvent): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (
			!window.webContents.isDestroyed() &&
			isAllowedOrigin(window.webContents.getURL(), appOrigins)
		) {
			window.webContents.send(CHANNELS.projectEvent, event);
		}
	}
}

function sendTerminalEvent(event: TerminalEvent): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (
			!window.webContents.isDestroyed() &&
			isAllowedOrigin(window.webContents.getURL(), appOrigins)
		)
			window.webContents.send(TERMINAL_CHANNELS.event, event);
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
	const projects = workspaceServices.projects;
	if (
		runtimeDiscovery.signal.aborted ||
		!currentSupervisor ||
		!threads ||
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
		activeProjectId = selected.project.id;
		const opened = await untilAborted(
			Promise.resolve(projects.openProject({projectId: selected.project.id})),
			signal,
		);
		if (opened.status !== 'opened') return opened;
		return connectedProject(opened.project, signal);
	} catch (error) {
		if (error instanceof NanocoderFailure)
			throw new IpcFailure(error.code, error.message);
		throw error;
	} finally {
		if (connecting === attempt) connecting = undefined;
		settle();
	}
}

function connectedProject(
	project: ProjectInfo,
	signal: AbortSignal,
): ConnectResult {
	const currentSupervisor = supervisor;
	if (!currentSupervisor || !threads)
		throw new IpcFailure('AGENT_UNAVAILABLE', 'The desktop cannot connect now');
	const connection = currentSupervisor.getConnection(project.id);
	signal.throwIfAborted();
	if (
		activeProjectId !== project.id ||
		currentSupervisor.getConnection(project.id) !== connection
	)
		throw new IpcFailure(
			'AGENT_UNAVAILABLE',
			'The project process changed while connecting',
		);
	threads.attachProject(project.id);
	currentSupervisor.replayState(project.id);
	return {status: 'connected', agent: connection.agent};
}

export function closeNanocoder(): Promise<void> {
	runtimeDiscovery.abort();
	rendererAttachment.abort(
		new IpcFailure('AGENT_UNAVAILABLE', 'The desktop is shutting down'),
	);
	return disposeDesktop({
		unsubscribe: unsubscribeProjectEvents,
		cancelPermissions: async () => {
			try {
				await Promise.all([
					terminal?.close(),
					rendererCleanup,
					connecting,
					threads?.detach(workspaceServices.store?.projects.list() ?? []),
				]);
			} finally {
				controlRuntime?.dispose();
				threads?.dispose();
			}
		},
		supervisor: workspaceServices.supervisor,
		store: workspaceServices.store,
	});
}

function watchRenderer(contents: WebContents): void {
	let attached = false;
	const detach = () => {
		if (!attached) return;
		const attempt = connecting;
		rendererAttachment.abort(
			new IpcFailure('AGENT_UNAVAILABLE', 'The app renderer detached'),
		);
		rendererAttachment = new AbortController();
		activeProjectId = undefined;
		invalidateControls();
		rendererCleanup = Promise.allSettled([
			terminal?.activate(null),
			rendererCleanup,
			threads?.detach(
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
	if (services.store) {
		const store = services.store;
		terminal = new TerminalService({
			project: id => store.projects.get(id),
			projects: () => store.projects.list(),
			createHost: createUtilityPtyHost,
			emit: sendTerminalEvent,
		});
	}
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
				activity: projectId =>
					threads?.activity(projectId) ?? {
						runningTurn: false,
						openSessions: 0,
						preparing: false,
						lastActivityAt: 0,
					},
				recover: async (project, connection, signal) => {
					await threads?.restore(project, connection, signal);
				},
			});
	const ownedSupervisor = supervisor;
	workspaceServices = {
		...services,
		supervisor: services.supervisor ?? supervisor,
		stopProject: services.stopProject ?? (supervisor ? stopProject : undefined),
		restartProject:
			services.restartProject ??
			(supervisor
				? async projectId => {
						const chosen = workspaceServices.store?.projects.get(projectId);
						if (!chosen || !supervisor)
							throw new IpcFailure('NOT_FOUND', 'Project not found');
						if (connecting)
							throw new IpcFailure(
								'BUSY',
								'Already connecting to Nanocoder',
								true,
							);
						if (threads?.projectOperations.isBusy(projectId))
							throw new IpcFailure(
								'BUSY',
								'Stop the current operation first',
								true,
							);
						controlRuntime?.invalidate(projectId);
						const {signal} = rendererAttachment;
						const state = await untilAborted(
							supervisor.restart(chosen),
							signal,
						);
						if (
							state.status === 'ready' &&
							activeProjectId === projectId &&
							workspaceServices.projects
						) {
							const opened = await untilAborted(
								Promise.resolve(
									workspaceServices.projects.openProject({projectId}),
								),
								signal,
							);
							if (opened.status === 'opened') {
								try {
									connectedProject(opened.project, signal);
								} catch (error) {
									if (error instanceof NanocoderFailure)
										throw new IpcFailure(error.code, error.message);
									throw error;
								}
							}
						}
						return supervisor.getState(projectId);
					}
				: undefined),
		diagnostics:
			services.diagnostics ??
			(supervisor
				? new DiagnosticsExporter({
						read: (projectId, snapshotId) => {
							if (!supervisor)
								throw new IpcFailure('NOT_FOUND', 'Project not found');
							return supervisor.getCapturedDiagnostics(projectId, snapshotId);
						},
						review: async snapshot => {
							const {response} = await dialog.showMessageBox({
								type: 'question',
								title: 'Review redacted diagnostics',
								message: 'Review these diagnostics before exporting',
								detail:
									snapshot.lines.join('\n') || 'No diagnostics were captured.',
								buttons: ['Choose destination', 'Cancel'],
								defaultId: 1,
								cancelId: 1,
								noLink: true,
							});
							return response === 0;
						},
						chooseDestination: async () => {
							const chosen = await dialog.showSaveDialog({
								title: 'Export redacted diagnostics',
								defaultPath: 'nanocoder-diagnostics.txt',
								filters: [{name: 'Text', extensions: ['txt']}],
							});
							return chosen.canceled ? undefined : chosen.filePath;
						},
						write: (destination, contents) =>
							writeFile(destination, contents, {mode: 0o600, flag: 'wx'}),
					})
				: undefined),
		projects:
			services.projects ??
			(services.store && ownedSupervisor
				? createProjectService({
						store: services.store,
						chooseRoot: chooseProjectRoot,
						supervisor: {
							probeProject: project => ownedSupervisor.probeProject(project),
							stop: stopProject,
						},
						signal: () => rendererAttachment.signal,
						beforeOpenProject: async project => {
							await terminal?.activate(project.id);
						},
						announceProject: project => {
							activeProjectId = project.id;
							threads?.attachProject(project.id);
							supervisor?.announceProject(project);
						},
					})
				: undefined),
	};
	threads =
		!services.threads && services.store && supervisor
			? createThreadService({
					store: services.store,
					supervisor,
					onEvent: sendProjectEvent,
					onSessionPrepared: context =>
						availableControls().hooks.onSessionPrepared(context),
					beforeFirstPrompt: context =>
						availableControls().hooks.beforeFirstPrompt(context),
					validateBeforePrepare: (lease, thread) =>
						availableControls().hooks.validateBeforePrepare(lease, thread),
					resolveLiveMode: (...args) =>
						availableControls().hooks.resolveLiveMode(...args),
					confirmDeleteHistory: async ({project, thread}) => {
						const options = {
							type: 'warning' as const,
							title: 'Delete chat history?',
							message: 'Delete this chat history from Nanocoder?',
							detail: `${thread.title}\n${project.canonicalRoot}\nThis deletes Nanocoder's saved history. Removing a thread from the desktop does not do this.`,
							buttons: ['Delete chat history', 'Cancel'],
							defaultId: 1,
							cancelId: 1,
							noLink: true,
						};
						const window = BrowserWindow.getFocusedWindow();
						const {response} = window
							? await dialog.showMessageBox(window, options)
							: await dialog.showMessageBox(options);
						return response === 0;
					},
				})
			: undefined;
	workspaceServices.threads = services.threads ?? threads;
	if (threads && services.store && ownedSupervisor) {
		controlRuntime = createWorkspaceControls({
			store: services.store,
			threads,
			getConnection: threads.getControlConnection,
			publishControls: controls => ownedSupervisor.publishControls(controls),
			publishThread: thread => ownedSupervisor.publishThread(thread),
			publishProject: project => ownedSupervisor.announceProject(project),
			confirmYolo: snapshot =>
				confirmYolo({
					...snapshot,
					ask: async options => {
						const window = BrowserWindow.getFocusedWindow();
						const {response} = window
							? await dialog.showMessageBox(window, options)
							: await dialog.showMessageBox(options);
						return response;
					},
				}),
		});
		workspaceServices.controls = services.controls ?? controlRuntime.controls;
		workspaceServices.threads = {
			...threads,
			setThreadMode: controlRuntime.setThreadMode,
		};
		if (workspaceServices.projects)
			workspaceServices.projects = {
				...workspaceServices.projects,
				setProjectDefaultMode: controlRuntime.setProjectDefaultMode,
			};
	}
	app.on('web-contents-created', (_event, contents) => watchRenderer(contents));
	for (const window of BrowserWindow.getAllWindows())
		watchRenderer(window.webContents);
	registerWorkspaceHandlers(registerHandler, allowedOrigins, workspaceServices);
	registerTerminalHandlers(registerHandler, allowedOrigins, terminal);
	unsubscribeProjectEvents = workspaceServices.supervisor?.subscribe(event => {
		if (event.type === 'supervisor' && event.state.status === 'untrusted') {
			const store = workspaceServices.store;
			const project = store?.projects.get(event.projectId);
			if (project?.trusted) store?.projects.save({...project, trusted: false});
		}
		if (event.type !== 'turn') sendProjectEvent(event);
		if (
			(event.type === 'supervisor' &&
				event.state.status !== 'ready' &&
				event.state.status !== 'starting') ||
			event.type === 'project-removed' ||
			(event.type === 'project' && !event.project.trusted)
		)
			controlRuntime?.invalidate(event.projectId);
		else if (event.type === 'thread-removed')
			controlRuntime?.invalidateThread(event.projectId, event.threadId);
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
}
