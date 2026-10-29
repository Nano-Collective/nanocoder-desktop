import {randomUUID} from 'node:crypto';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {ThreadService} from '@/main/ipc/workspace-services';
import {
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import {type SupervisorClock, systemClock} from '@/main/nanocoder/clock';
import type {
	ProjectActivity,
	ProjectSupervisor,
} from '@/main/nanocoder/supervisor';
import {canonicalPath} from '@/main/paths';
import type {DesktopStore} from '@/main/store/contracts';
import {threadTitlePatch, validate} from '@/main/store/validation';
import type {
	ProjectEvent,
	ProjectInfo,
	ThreadInfo,
	ThreadRequest,
	TurnEvent,
} from '@/shared/ipc';

interface ThreadOptions {
	store: DesktopStore;
	supervisor: Pick<
		ProjectSupervisor,
		| 'ensureProcess'
		| 'getState'
		| 'getConnection'
		| 'getCapabilityGates'
		| 'prompt'
		| 'cancel'
		| 'answerPermission'
		| 'subscribe'
		| 'subscribeTitles'
		| 'publishThread'
		| 'publishThreadRemoved'
		| 'stop'
	>;
	now?(): Date;
	clock?: Pick<SupervisorClock, 'now'>;
	onEvent?(event: ProjectEvent): void;
	confirmDeleteHistory?(snapshot: {
		project: ProjectInfo;
		thread: ThreadInfo;
	}): Promise<boolean>;
}

type AsyncThreadService = {
	[K in keyof ThreadService]: (
		...args: Parameters<ThreadService[K]>
	) => Promise<Awaited<ReturnType<ThreadService[K]>>>;
};
type ThreadRuntimeService = AsyncThreadService & {
	dispose(): void;
	attachProject(projectId: string): void;
	activity(projectId: string): ProjectActivity;
	restore(
		project: ProjectInfo,
		connection: NanocoderConnection,
		signal: AbortSignal,
	): Promise<void>;
	detach(projects: Iterable<ProjectInfo>): Promise<void>;
};

export function createThreadService(
	options: ThreadOptions,
): ThreadRuntimeService {
	const snapshots = new Map<string, {sequence: number; events: TurnEvent[]}>();
	const prepared = new Map<string, NanocoderConnection>();
	const pending = new Map<string, string>();
	const mutations = new Set<string>();
	const permissionIds = new Map<string, Set<string>>();
	const attached = new Set<string>();
	const lastActivity = new Map<string, number>();
	const currentSessions = new Map<
		string,
		{thread: ThreadInfo; connection: NanocoderConnection}
	>();
	const restoring = new Map<string, AbortSignal>();
	const operations = new Map<string, Set<Promise<unknown>>>();
	let attachment = new AbortController();
	let disposed = false;
	const operation = <T>(
		projectId: string,
		work: (signal: AbortSignal) => Promise<T>,
	): Promise<T> => {
		const {signal} = attachment;
		const task = Promise.resolve().then(() => {
			signal.throwIfAborted();
			return work(signal);
		});
		const tasks = operations.get(projectId) ?? new Set<Promise<unknown>>();
		tasks.add(task);
		operations.set(projectId, tasks);
		const finished = () => {
			tasks.delete(task);
			if (!tasks.size && operations.get(projectId) === tasks)
				operations.delete(projectId);
		};
		void task.then(finished, finished);
		return task;
	};
	const now = () => (options.now?.() ?? new Date()).toISOString();
	const publishThread = (thread: ThreadInfo) => {
		options.supervisor.publishThread(thread);
		return thread;
	};
	const saveThread = (thread: ThreadInfo) => {
		options.store.threads.save(thread);
		return publishThread(thread);
	};
	const getProject = (projectId: string) => {
		if (disposed)
			throw new IpcFailure('AGENT_UNAVAILABLE', 'The thread service stopped');
		const project = options.store.projects.get(projectId);
		if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
		return project;
	};
	const attachProject = (projectId: string) => {
		getProject(projectId);
		attached.add(projectId);
		lastActivity.set(projectId, (options.clock ?? systemClock).now());
	};
	const remember = (thread: ThreadInfo, connection: NanocoderConnection) => {
		prepared.set(thread.id, connection);
		currentSessions.set(thread.projectId, {
			thread: structuredClone(thread),
			connection,
		});
		attachProject(thread.projectId);
	};
	const unavailable = async (): Promise<never> => {
		throw new IpcFailure('UNAVAILABLE', 'This feature is not available yet');
	};
	const getThread = ({projectId, threadId}: ThreadRequest) => {
		getProject(projectId);
		const thread = options.store.threads.get(projectId, threadId);
		if (!thread) throw new IpcFailure('NOT_FOUND', 'Thread not found');
		return thread;
	};
	const assertMutable = (thread: ThreadInfo) => {
		const active = options.supervisor.getState(thread.projectId).activeThreadId;
		if (
			mutations.has(thread.id) ||
			(restoring.has(thread.projectId) &&
				currentSessions.get(thread.projectId)?.thread.id === thread.id) ||
			pending.get(thread.projectId) === thread.id ||
			(thread.nanocoderSessionId !== null &&
				active === thread.nanocoderSessionId)
		)
			throw new IpcFailure('BUSY', 'Wait for this thread to finish', true);
	};
	const snapshot = (request: ThreadRequest) => ({
		thread: getThread(request),
		...(snapshots.get(request.threadId) ?? {sequence: 0, events: []}),
		replaying: false,
	});
	const append = (thread: ThreadInfo, events: TurnEvent[]) => {
		const state = snapshots.get(thread.id) ?? {sequence: 0, events: []};
		state.events.push(...structuredClone(events));
		state.sequence++;
		snapshots.set(thread.id, state);
		options.onEvent?.({
			type: 'turn',
			projectId: thread.projectId,
			threadId: thread.id,
			sequence: state.sequence,
			events: structuredClone(events),
		});
	};
	const unsubscribe = options.supervisor.subscribe(event => {
		if (event.type !== 'turn') return;
		const thread = [
			...options.store.threads.list(event.projectId, 'active'),
			...options.store.threads.list(event.projectId, 'archived'),
		].find(thread => thread.nanocoderSessionId === event.threadId);
		if (!thread) return;
		const ids = permissionIds.get(thread.id) ?? new Set<string>();
		let changed = false;
		for (const item of event.events) {
			if (item.type === 'permission' && !ids.has(item.request.id)) {
				ids.add(item.request.id);
				changed = true;
			} else if (item.type === 'permission-closed' && ids.delete(item.id)) {
				changed = true;
			}
		}
		if (changed) {
			if (ids.size) permissionIds.set(thread.id, ids);
			else permissionIds.delete(thread.id);
			const runState = ids.size ? 'waiting-approval' : 'running';
			if (thread.runState !== runState)
				saveThread({...thread, runState, lastActivityAt: now()});
		}
		append(thread, event.events);
	});
	const unsubscribeTitles = options.supervisor.subscribeTitles(change => {
		const thread = [
			...options.store.threads.list(change.projectId, 'active'),
			...options.store.threads.list(change.projectId, 'archived'),
		].find(thread => thread.nanocoderSessionId === change.sessionId);
		if (
			thread &&
			thread.title !== change.title &&
			options.store.threads.getTitleManuallySet(thread.projectId, thread.id) ===
				false
		)
			publishThread(
				options.store.threads.setTitle({
					projectId: thread.projectId,
					threadId: thread.id,
					title: change.title,
					manuallySet: false,
				}),
			);
	});
	const validateProject = async (thread: ThreadInfo) => {
		const project = getProject(thread.projectId);
		if (!project.trusted)
			throw new IpcFailure(
				'DENIED',
				'Trust this project before sending a prompt',
			);
		try {
			if (
				(await canonicalPath(project.canonicalRoot)) !==
					project.canonicalRoot ||
				project.sessionCwd !== project.canonicalRoot ||
				thread.sessionCwd !== project.sessionCwd
			)
				throw new Error();
		} catch {
			throw new IpcFailure(
				'DENIED',
				'The project root changed; locate and trust the folder again',
			);
		}
		return project;
	};
	const removeMetadata = (request: ThreadRequest) => {
		options.store.threads.remove(request.projectId, request.threadId);
		if (currentSessions.get(request.projectId)?.thread.id === request.threadId)
			currentSessions.delete(request.projectId);
		snapshots.delete(request.threadId);
		prepared.delete(request.threadId);
		permissionIds.delete(request.threadId);
		const ui = options.store.getUiState();
		options.store.updateUiState({
			activeThreadId:
				ui.activeThreadId === request.threadId ? null : ui.activeThreadId,
			openThreadIds: ui.openThreadIds.filter(id => id !== request.threadId),
		});
		options.supervisor.publishThreadRemoved(
			request.projectId,
			request.threadId,
		);
	};
	const failure = (error: unknown): never => {
		if (error instanceof IpcFailure) throw error;
		if (error instanceof NanocoderFailure)
			throw new IpcFailure(error.code, error.message);
		throw new IpcFailure(
			'AGENT_UNAVAILABLE',
			'The thread request could not finish',
		);
	};
	const select = (request: ThreadRequest) => {
		attachProject(request.projectId);
		const ids = options.store.getUiState().openThreadIds;
		options.store.updateUiState({
			activeProjectId: request.projectId,
			activeThreadId: request.threadId,
			openThreadIds: ids.includes(request.threadId)
				? ids
				: [...ids.slice(-99), request.threadId],
		});
	};
	const startingMode = (thread: ThreadInfo, project: ProjectInfo) =>
		thread.mode === 'yolo' ? project.defaultMode : thread.mode;
	const resume = async (
		thread: ThreadInfo,
		connection: NanocoderConnection,
		project: ProjectInfo,
		signal: AbortSignal,
	) => {
		const sessionId = thread.nanocoderSessionId;
		if (!sessionId) return;
		const restored = await connection.resumeSession(
			sessionId,
			startingMode(thread, project),
		);
		signal.throwIfAborted();
		const request = {projectId: thread.projectId, threadId: thread.id};
		const current = getThread(request);
		if (current.nanocoderSessionId !== sessionId)
			throw new IpcFailure('DENIED', 'The thread session changed');
		await validateProject(current);
		signal.throwIfAborted();
		if (options.supervisor.getConnection(project.id) !== connection)
			throw new IpcFailure('AGENT_UNAVAILABLE', 'The project process changed');
		const fresh = getThread(request);
		if (
			fresh.nanocoderSessionId !== sessionId ||
			fresh.sessionCwd !== current.sessionCwd
		)
			throw new IpcFailure('DENIED', 'The thread session changed');
		saveThread({
			...fresh,
			mode: restored.session.mode,
			runState: 'ready',
			viewOnlyReason: null,
		});
		remember(fresh, connection);
		snapshots.set(thread.id, {
			sequence: (snapshots.get(thread.id)?.sequence ?? 0) + 1,
			events: structuredClone(restored.history),
		});
	};
	const viewOnly = (request: ThreadRequest, error: unknown) => {
		const reason =
			error instanceof NanocoderFailure && error.code === 'NOT_FOUND'
				? 'Nanocoder has no saved history for this thread. An empty session may not have been saved before the process ended, or its history was deleted or expired.'
				: error instanceof IpcFailure || error instanceof NanocoderFailure
					? error.message
					: 'Nanocoder could not resume this thread';
		saveThread({
			...getThread(request),
			runState: 'view-only',
			viewOnlyReason: reason,
		});
	};
	return {
		attachProject,
		activity: (projectId: string) => ({
			runningTurn:
				options.supervisor.getState(projectId).activeThreadId !== null,
			openSessions: attached.has(projectId) ? 1 : 0,
			preparing: pending.has(projectId) || restoring.has(projectId),
			lastActivityAt: lastActivity.get(projectId) ?? 0,
		}),
		restore: async (project, connection, signal) => {
			signal.throwIfAborted();
			const cached = currentSessions.get(project.id);
			if (!cached || !attached.has(project.id)) return;
			const request = {projectId: project.id, threadId: cached.thread.id};
			const check = async () => {
				signal.throwIfAborted();
				if (disposed || !attached.has(project.id))
					throw new IpcFailure(
						'AGENT_UNAVAILABLE',
						'The thread workspace detached',
					);
				const thread = getThread(request);
				const owner = getProject(project.id);
				if (
					thread.nanocoderSessionId !== cached.thread.nanocoderSessionId ||
					!thread.nanocoderSessionId ||
					thread.sessionCwd !== cached.thread.sessionCwd ||
					thread.sessionCwd !== owner.sessionCwd ||
					owner.sessionCwd !== owner.canonicalRoot ||
					owner.canonicalRoot !== project.canonicalRoot ||
					owner.sessionCwd !== project.sessionCwd ||
					cached.connection.agent.root !== project.canonicalRoot ||
					connection.agent.root !== project.canonicalRoot ||
					(await canonicalPath(owner.canonicalRoot)) !== owner.canonicalRoot
				)
					throw new IpcFailure(
						'DENIED',
						'The project folder changed; open it again before resuming',
					);
				signal.throwIfAborted();
				const fresh = getThread(request);
				if (
					getProject(project.id).canonicalRoot !== owner.canonicalRoot ||
					getProject(project.id).sessionCwd !== owner.sessionCwd ||
					fresh.nanocoderSessionId !== thread.nanocoderSessionId ||
					fresh.sessionCwd !== thread.sessionCwd
				)
					throw new IpcFailure('DENIED', 'The thread session changed');
				return {...fresh, nanocoderSessionId: thread.nanocoderSessionId};
			};
			restoring.set(project.id, signal);
			try {
				const thread = await check();
				const restored = await connection.resumeSession(
					thread.nanocoderSessionId,
					startingMode(thread, project),
				);
				const fresh = await check();
				snapshots.set(thread.id, {
					sequence: (snapshots.get(thread.id)?.sequence ?? 0) + 1,
					events: structuredClone(restored.history),
				});
				remember(fresh, connection);
				saveThread({
					...fresh,
					mode: restored.session.mode,
					runState: 'ready',
					viewOnlyReason: null,
				});
			} finally {
				if (restoring.get(project.id) === signal) restoring.delete(project.id);
			}
		},
		detach: async projects => {
			const tasks = [...operations.values()].flatMap(values => [...values]);
			const ids = new Set([
				...pending.keys(),
				...restoring.keys(),
				...operations.keys(),
			]);
			const candidates = new Set([
				...attached,
				...[...projects].map(project => project.id),
			]);
			attachment.abort(
				new IpcFailure('AGENT_UNAVAILABLE', 'The app renderer detached'),
			);
			attachment = new AbortController();
			for (const projectId of candidates) {
				lastActivity.set(projectId, (options.clock ?? systemClock).now());
				const state = options.supervisor.getState(projectId);
				if (
					state.activeThreadId !== null ||
					state.status === 'starting' ||
					state.status === 'stopping' ||
					state.restart.nextAttemptAt !== null
				)
					ids.add(projectId);
			}
			attached.clear();
			pending.clear();
			restoring.clear();
			permissionIds.clear();
			await Promise.allSettled([
				...[...ids].map(async id => options.supervisor.stop(id)),
				...tasks,
			]);
		},
		dispose: () => {
			disposed = true;
			attachment.abort(
				new IpcFailure('AGENT_UNAVAILABLE', 'The thread service stopped'),
			);
			unsubscribe();
			unsubscribeTitles();
			permissionIds.clear();
		},
		listThreads: async ({projectId, archiveState}) => {
			getProject(projectId);
			return options.store.threads.list(projectId, archiveState);
		},
		createThread: async ({projectId}) => {
			const project = getProject(projectId);
			const thread: ThreadInfo = {
				id: randomUUID(),
				projectId,
				nanocoderSessionId: null,
				title: 'new thread',
				archiveState: 'active',
				runState: 'new',
				lastActivityAt: now(),
				sessionCwd: project.sessionCwd,
				mode: project.defaultMode,
				viewOnlyReason: null,
			};
			saveThread(thread);
			select({projectId, threadId: thread.id});
			return thread;
		},
		openThread: request =>
			operation(request.projectId, async signal => {
				const thread = getThread(request);
				select(request);
				if (!thread.nanocoderSessionId)
					return structuredClone(snapshot(request));
				let preparing = false;
				try {
					const project = await validateProject(thread);
					signal.throwIfAborted();
					const state = options.supervisor.getState(project.id);
					if (
						state.status === 'ready' &&
						prepared.get(thread.id) ===
							options.supervisor.getConnection(project.id)
					)
						return structuredClone(snapshot(request));
					if (pending.has(project.id) || state.activeThreadId !== null)
						return structuredClone(snapshot(request));
					pending.set(project.id, thread.id);
					preparing = true;
					await options.supervisor.ensureProcess(project);
					signal.throwIfAborted();
					await validateProject(getThread(request));
					signal.throwIfAborted();
					await resume(
						getThread(request),
						options.supervisor.getConnection(project.id),
						project,
						signal,
					);
				} catch (error) {
					if (signal.aborted) return failure(signal.reason);
					if (
						error instanceof IpcFailure &&
						['DENIED', 'BUSY'].includes(error.code)
					)
						return failure(error);
					viewOnly(request, error);
				} finally {
					if (preparing && !signal.aborted) pending.delete(thread.projectId);
				}
				return structuredClone(snapshot(request));
			}),
		getThreadSnapshot: async request => structuredClone(snapshot(request)),
		renameThread: async request => {
			const patch = validate(threadTitlePatch, {...request, manuallySet: true});
			const thread = getThread(request);
			assertMutable(thread);
			const sessionId = thread.nanocoderSessionId;
			if (!sessionId)
				return publishThread(options.store.threads.setTitle(patch));
			const project = getProject(thread.projectId);
			const unchanged = () => {
				const current = getThread(request);
				const owner = getProject(thread.projectId);
				if (
					current.nanocoderSessionId !== sessionId ||
					current.sessionCwd !== thread.sessionCwd ||
					owner.canonicalRoot !== project.canonicalRoot ||
					owner.sessionCwd !== project.sessionCwd
				)
					throw new IpcFailure('DENIED', 'The thread session changed');
				return current;
			};
			mutations.add(thread.id);
			try {
				const owner = await validateProject(unchanged());
				await options.supervisor.ensureProcess(owner);
				await validateProject(unchanged());
				const gate = options.supervisor.getCapabilityGates(owner.id).features
					.rename;
				if (!gate.enabled) throw new IpcFailure('UNSUPPORTED', gate.reason);
				const connection = options.supervisor.getConnection(owner.id);
				const title = await connection.renameSession(sessionId, patch.title);
				await validateProject(unchanged());
				if (options.supervisor.getConnection(owner.id) !== connection)
					throw new IpcFailure(
						'AGENT_UNAVAILABLE',
						'The project process changed',
					);
				return publishThread(options.store.threads.setTitle({...patch, title}));
			} catch (error) {
				return failure(error);
			} finally {
				mutations.delete(thread.id);
			}
		},
		archiveThread: async request => {
			const previous = getThread(request);
			assertMutable(previous);
			const thread = {
				...previous,
				archiveState: request.archived ? 'archived' : 'active',
			} satisfies ThreadInfo;
			saveThread(thread);
			return thread;
		},
		removeThread: async request => {
			assertMutable(getThread(request));
			removeMetadata(request);
			return null;
		},
		deleteThreadHistory: async request => {
			const thread = getThread(request);
			assertMutable(thread);
			const project = getProject(thread.projectId);
			const sessionId = thread.nanocoderSessionId;
			if (!sessionId)
				throw new IpcFailure(
					'UNSUPPORTED',
					'This thread has no Nanocoder history; remove its desktop row instead',
				);
			const unchanged = () => {
				const current = getThread(request);
				const owner = getProject(thread.projectId);
				if (
					current.nanocoderSessionId !== sessionId ||
					current.sessionCwd !== thread.sessionCwd ||
					current.title !== thread.title ||
					owner.canonicalRoot !== project.canonicalRoot ||
					owner.sessionCwd !== project.sessionCwd
				)
					throw new IpcFailure(
						'DENIED',
						'The thread changed; confirm its history deletion again',
					);
				return current;
			};
			mutations.add(thread.id);
			try {
				const confirmed = await options.confirmDeleteHistory?.(
					structuredClone({project, thread}),
				);
				if (confirmed !== true) return {status: 'cancelled'};
				const owner = await validateProject(unchanged());
				await options.supervisor.ensureProcess(owner);
				await validateProject(unchanged());
				const gate = options.supervisor.getCapabilityGates(owner.id).features
					.delete;
				if (!gate.enabled) throw new IpcFailure('UNSUPPORTED', gate.reason);
				await options.supervisor
					.getConnection(owner.id)
					.deleteSession(sessionId);
				unchanged();
				removeMetadata(request);
				return {status: 'deleted'};
			} catch (error) {
				return failure(error);
			} finally {
				mutations.delete(thread.id);
			}
		},
		promptThread: request =>
			operation(request.projectId, async signal => {
				let thread = getThread(request);
				assertMutable(thread);
				if (thread.runState === 'view-only')
					throw new IpcFailure(
						'UNAVAILABLE',
						thread.viewOnlyReason ?? 'This thread cannot accept prompts',
					);
				if (thread.archiveState === 'archived')
					throw new IpcFailure(
						'DENIED',
						'Unarchive this thread before sending a prompt',
					);
				if (
					pending.has(thread.projectId) ||
					options.supervisor.getState(thread.projectId).activeThreadId !== null
				)
					throw new IpcFailure(
						'BUSY',
						'Nanocoder is already working on a turn',
						true,
					);
				pending.set(thread.projectId, thread.id);
				let started = false;
				try {
					const project = await validateProject(thread);
					signal.throwIfAborted();
					await options.supervisor.ensureProcess(project);
					signal.throwIfAborted();
					await validateProject(getThread(request));
					signal.throwIfAborted();
					const connection = options.supervisor.getConnection(project.id);
					if (!thread.nanocoderSessionId) {
						const session = await connection.newSession(
							startingMode(thread, project),
						);
						signal.throwIfAborted();
						try {
							thread = {
								...getThread(request),
								nanocoderSessionId: session.id,
								mode: session.mode,
							};
							saveThread(thread);
							remember(thread, connection);
						} catch (error) {
							await options.supervisor.stop(project.id).catch(() => undefined);
							if (error instanceof IpcFailure) throw error;
							throw new IpcFailure(
								'INTERNAL',
								'The session id could not be stored',
							);
						}
					} else if (prepared.get(thread.id) !== connection) {
						await resume(thread, connection, project, signal);
						thread = getThread(request);
					}
					await validateProject(getThread(request));
					signal.throwIfAborted();
					if (options.supervisor.getConnection(project.id) !== connection)
						throw new IpcFailure(
							'AGENT_UNAVAILABLE',
							'The project process changed before the prompt',
						);
					const sessionId = thread.nanocoderSessionId;
					if (!sessionId)
						throw new IpcFailure('AGENT_UNAVAILABLE', 'No session is ready');
					thread = {
						...thread,
						title:
							thread.title === 'new thread' &&
							options.store.threads.getTitleManuallySet(
								thread.projectId,
								thread.id,
							) === false
								? request.text.trim().replace(/\s+/g, ' ').slice(0, 80)
								: thread.title,
						runState: 'running',
						lastActivityAt: now(),
					};
					saveThread(thread);
					remember(thread, connection);
					started = true;
					append(thread, [{type: 'user', text: request.text}]);
					const result = await options.supervisor.prompt(
						project.id,
						sessionId,
						request.text,
					);
					saveThread({
						...getThread(request),
						runState:
							result.stopReason === 'cancelled' ? 'interrupted' : 'ready',
						lastActivityAt: now(),
					});
					return result;
				} catch (error) {
					if (started && !disposed) {
						const current = options.store.threads.get(
							thread.projectId,
							thread.id,
						);
						if (current?.nanocoderSessionId === thread.nanocoderSessionId)
							saveThread({
								...current,
								runState: 'failed',
								lastActivityAt: now(),
							});
					}
					return failure(error);
				} finally {
					if (!signal.aborted) {
						pending.delete(thread.projectId);
						permissionIds.delete(thread.id);
					}
				}
			}),
		cancelThread: async request => {
			const thread = getThread(request);
			const sessionId = thread.nanocoderSessionId;
			if (
				sessionId &&
				options.supervisor.getState(thread.projectId).activeThreadId ===
					sessionId
			) {
				try {
					await options.supervisor.cancel(thread.projectId, sessionId);
				} catch (error) {
					return failure(error);
				}
			}
			return null;
		},
		setThreadMode: unavailable,
		answerThreadPermission: async request => {
			const thread = getThread(request);
			const sessionId = thread.nanocoderSessionId;
			const denied = () =>
				new IpcFailure(
					'DENIED',
					'This permission request is not waiting for this thread',
				);
			if (
				!sessionId ||
				options.supervisor.getState(thread.projectId).activeThreadId !==
					sessionId
			)
				throw denied();
			const owner = await validateProject(thread);
			const current = getThread(request);
			const project = getProject(thread.projectId);
			if (
				!project.trusted ||
				current.nanocoderSessionId !== sessionId ||
				current.sessionCwd !== thread.sessionCwd ||
				project.canonicalRoot !== owner.canonicalRoot ||
				project.sessionCwd !== owner.sessionCwd ||
				options.supervisor.getState(thread.projectId).activeThreadId !==
					sessionId ||
				!options.supervisor.answerPermission(
					thread.projectId,
					sessionId,
					request.requestId,
					request.optionId,
				)
			)
				throw denied();
			return null;
		},
		discoverSessions: unavailable,
		importSession: unavailable,
	};
}
