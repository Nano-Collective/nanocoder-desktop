import {IpcFailure} from '@/main/ipc/handle-request';
import type {ProjectInfo, ThreadInfo} from '@/shared/ipc';

type ProjectOwner = Pick<
	ProjectInfo,
	'canonicalRoot' | 'sessionCwd' | 'trusted'
>;
type ThreadOwner = Pick<ThreadInfo, 'sessionCwd' | 'nanocoderSessionId'>;

export interface ProjectOperationLease {
	readonly projectId: string;
	readonly kind: string;
	readonly epoch: number;
	readonly canonicalRoot: string;
	readonly signal: AbortSignal;
}

interface ProjectOperationOptions {
	getProject(projectId: string): ProjectOwner | undefined;
	getThread(projectId: string, threadId: string): ThreadOwner | undefined;
	getConnection(projectId: string): object | undefined;
}

interface OperationScope {
	threadId?: string;
	signal?: AbortSignal;
}

interface LeaseState {
	abort: AbortController;
	thread?: ThreadOwner & {id: string};
	connection?: object;
	settlements: Set<Promise<void>>;
}

const unavailable = () =>
	new IpcFailure(
		'AGENT_UNAVAILABLE',
		'The project operation is no longer active',
	);
const denied = () => new IpcFailure('DENIED', 'The project session changed');
const observe = (pending: Promise<unknown>) =>
	pending.then(
		() => undefined,
		() => undefined,
	);

export function createProjectOperations(options: ProjectOperationOptions) {
	const slots = new Map<string, LeaseState>();
	const leases = new WeakMap<ProjectOperationLease, LeaseState>();
	const epochs = new Map<string, number>();
	let disposed = false;
	const projectOwner = (projectId: string) => {
		const project = options.getProject(projectId);
		if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
		if (!project.trusted || project.sessionCwd !== project.canonicalRoot)
			throw denied();
		return project;
	};
	const current = (lease: ProjectOperationLease, checkSession = true) => {
		const state = leases.get(lease);
		if (!state) throw new IpcFailure('DENIED', 'Invalid project operation');
		if (
			disposed ||
			state.abort.signal.aborted ||
			slots.get(lease.projectId) !== state ||
			(epochs.get(lease.projectId) ?? 0) !== lease.epoch
		)
			throw unavailable();
		const project = projectOwner(lease.projectId);
		if (project.canonicalRoot !== lease.canonicalRoot) throw denied();
		if (state.thread) {
			const thread = options.getThread(lease.projectId, state.thread.id);
			if (!thread) throw new IpcFailure('NOT_FOUND', 'Thread not found');
			if (
				thread.sessionCwd !== lease.canonicalRoot ||
				(checkSession &&
					thread.nanocoderSessionId !== state.thread.nanocoderSessionId)
			)
				throw denied();
		}
		if (
			state.connection &&
			options.getConnection(lease.projectId) !== state.connection
		)
			throw unavailable();
		return state;
	};
	const invalidate = (projectId: string, settlement?: Promise<unknown>) => {
		const observed = settlement && observe(settlement);
		epochs.set(projectId, (epochs.get(projectId) ?? 0) + 1);
		const state = slots.get(projectId);
		if (!state) return;
		if (observed) state.settlements.add(observed);
		state.abort.abort(unavailable());
	};
	const bindThread = (lease: ProjectOperationLease, threadId: string) => {
		const state = current(lease);
		if (state.thread && state.thread.id !== threadId) throw denied();
		const thread = options.getThread(lease.projectId, threadId);
		if (!thread) throw new IpcFailure('NOT_FOUND', 'Thread not found');
		if (thread.sessionCwd !== lease.canonicalRoot) throw denied();
		state.thread = {...thread, id: threadId};
	};
	const authority = {
		async runProjectOperation<T>(
			projectId: string,
			kind: string,
			work: (lease: ProjectOperationLease) => Promise<T>,
			scope: OperationScope = {},
		): Promise<T> {
			if (disposed || scope.signal?.aborted) throw unavailable();
			if (slots.has(projectId))
				throw new IpcFailure('BUSY', 'Wait for this project to finish', true);
			const project = projectOwner(projectId);
			const abort = new AbortController();
			const lease: ProjectOperationLease = Object.freeze({
				projectId,
				kind,
				epoch: epochs.get(projectId) ?? 0,
				canonicalRoot: project.canonicalRoot,
				signal: abort.signal,
			});
			const state: LeaseState = {abort, settlements: new Set()};
			slots.set(projectId, state);
			leases.set(lease, state);
			const onAbort = () => {
				if (slots.get(projectId) === state) invalidate(projectId);
			};
			scope.signal?.addEventListener('abort', onAbort, {once: true});
			try {
				if (scope.threadId !== undefined) bindThread(lease, scope.threadId);
				current(lease);
				const result = await work(lease);
				current(lease);
				return result;
			} catch (error) {
				if (abort.signal.aborted) throw unavailable();
				throw error;
			} finally {
				while (state.settlements.size) {
					const pending = [...state.settlements];
					state.settlements.clear();
					await Promise.all(pending);
				}
				scope.signal?.removeEventListener('abort', onAbort);
				if (slots.get(projectId) === state) slots.delete(projectId);
			}
		},
		isBusy: (projectId: string) => slots.has(projectId),
		runOwnedStep: async <T>(
			lease: ProjectOperationLease,
			work: () => Promise<T>,
		): Promise<T> => {
			const state = current(lease);
			const pending = work();
			state.settlements.add(observe(pending));
			let result: T;
			try {
				result = await pending;
			} catch (error) {
				current(lease);
				throw error;
			}
			current(lease);
			return result;
		},
		assertCurrent: (lease: ProjectOperationLease) => {
			current(lease);
		},
		bindThread,
		bindSession: (lease: ProjectOperationLease, sessionId: string) => {
			const state = current(lease, false);
			if (
				!state.thread ||
				!sessionId ||
				(state.thread.nanocoderSessionId !== null &&
					state.thread.nanocoderSessionId !== sessionId) ||
				options.getThread(lease.projectId, state.thread.id)
					?.nanocoderSessionId !== sessionId
			)
				throw denied();
			state.thread.nanocoderSessionId = sessionId;
		},
		bindConnection: (lease: ProjectOperationLease, connection: object) => {
			const state = current(lease);
			if (
				options.getConnection(lease.projectId) !== connection ||
				(state.connection && state.connection !== connection)
			)
				throw unavailable();
			state.connection = connection;
		},
		invalidate,
		invalidateThread: (
			projectId: string,
			threadId: string,
			settlement?: Promise<unknown>,
		) => {
			if (slots.get(projectId)?.thread?.id === threadId)
				invalidate(projectId, settlement);
		},
		dispose: () => {
			disposed = true;
			for (const projectId of slots.keys()) invalidate(projectId);
		},
	};
	return authority;
}
