import {randomUUID} from 'node:crypto';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {ThreadService} from '@/main/ipc/workspace-services';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import type {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import {canonicalPath} from '@/main/paths';
import type {DesktopStore} from '@/main/store/contracts';
import type {
	ProjectEvent,
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
		| 'stop'
	>;
	now?(): Date;
	onEvent?(event: ProjectEvent): void;
}

type AsyncThreadService = {
	[K in keyof ThreadService]: (
		...args: Parameters<ThreadService[K]>
	) => Promise<Awaited<ReturnType<ThreadService[K]>>>;
};

export function createThreadService(
	options: ThreadOptions,
): AsyncThreadService & {dispose(): void} {
	const snapshots = new Map<string, {sequence: number; events: TurnEvent[]}>();
	const pending = new Set<string>();
	const now = () => (options.now?.() ?? new Date()).toISOString();
	const getProject = (projectId: string) => {
		const project = options.store.projects.get(projectId);
		if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
		return project;
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
		if (thread) append(thread, event.events);
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
	return {
		dispose: unsubscribe,
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
			options.store.threads.save(thread);
			options.store.updateUiState({
				activeProjectId: projectId,
				activeThreadId: thread.id,
				openThreadIds: [...options.store.getUiState().openThreadIds, thread.id],
			});
			return thread;
		},
		openThread: unavailable,
		getThreadSnapshot: async request => structuredClone(snapshot(request)),
		renameThread: unavailable,
		archiveThread: async request => {
			const thread = {
				...getThread(request),
				archiveState: request.archived ? 'archived' : 'active',
			} satisfies ThreadInfo;
			options.store.threads.save(thread);
			return thread;
		},
		removeThread: async request => {
			getThread(request);
			options.store.threads.remove(request.projectId, request.threadId);
			const ui = options.store.getUiState();
			options.store.updateUiState({
				activeThreadId:
					ui.activeThreadId === request.threadId ? null : ui.activeThreadId,
				openThreadIds: ui.openThreadIds.filter(id => id !== request.threadId),
			});
			return null;
		},
		deleteThreadHistory: unavailable,
		promptThread: async request => {
			let thread = getThread(request);
			if (
				pending.has(thread.projectId) ||
				options.supervisor.getState(thread.projectId).activeThreadId !== null
			)
				throw new IpcFailure(
					'BUSY',
					'Nanocoder is already working on a turn',
					true,
				);
			pending.add(thread.projectId);
			try {
				const project = await validateProject(thread);
				await options.supervisor.ensureProcess(project);
				const connection = options.supervisor.getConnection(project.id);
				if (!thread.nanocoderSessionId) {
					const session = await connection.newSession(project.defaultMode);
					thread = {
						...thread,
						nanocoderSessionId: session.id,
						mode: session.mode,
					};
					options.store.threads.save(thread);
				}
				const sessionId = thread.nanocoderSessionId;
				if (!sessionId)
					throw new IpcFailure('AGENT_UNAVAILABLE', 'No session is ready');
				thread = {
					...thread,
					title:
						thread.title === 'new thread'
							? request.text.trim().replace(/\s+/g, ' ').slice(0, 80)
							: thread.title,
					runState: 'running',
					lastActivityAt: now(),
				};
				options.store.threads.save(thread);
				append(thread, [{type: 'user', text: request.text}]);
				const result = await options.supervisor.prompt(
					project.id,
					sessionId,
					request.text,
				);
				options.store.threads.save({
					...getThread(request),
					runState: 'ready',
					lastActivityAt: now(),
				});
				return result;
			} catch (error) {
				if (error instanceof IpcFailure) throw error;
				if (error instanceof NanocoderFailure)
					throw new IpcFailure(error.code, error.message);
				throw new IpcFailure(
					'AGENT_UNAVAILABLE',
					'The thread request could not finish',
				);
			} finally {
				pending.delete(thread.projectId);
			}
		},
		cancelThread: unavailable,
		setThreadMode: unavailable,
		answerThreadPermission: unavailable,
		discoverSessions: unavailable,
		importSession: unavailable,
	};
}
