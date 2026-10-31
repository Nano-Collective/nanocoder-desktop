import {IpcFailure} from '@/main/ipc/handle-request';
import {untilAborted} from '@/main/nanocoder/abort';
import type {ProjectInfo, ThreadInfo} from '@/shared/ipc';

type ProjectOwner = Pick<
	ProjectInfo,
	'canonicalRoot' | 'sessionCwd' | 'trusted'
>;
type ThreadOwner = Pick<ThreadInfo, 'sessionCwd' | 'nanocoderSessionId'>;

const access = Symbol('project-operation-access');
type Access = 'execution' | 'metadata' | 'confirmation';

interface LeaseOwner {
	readonly projectId: string;
	readonly kind: string;
	readonly epoch: number;
	readonly canonicalRoot: string;
	readonly signal: AbortSignal;
}

export interface ProjectOperationLease extends LeaseOwner {
	readonly [access]: 'execution';
}

export interface MetadataOperationLease extends LeaseOwner {
	readonly [access]: 'metadata';
}

export interface PendingProjectOperationLease extends LeaseOwner {
	readonly [access]: 'confirmation';
}

type AnyLease =
	| ProjectOperationLease
	| MetadataOperationLease
	| PendingProjectOperationLease;

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
	lease: AnyLease;
	abort: AbortController;
	sessionCwd: string;
	thread?: ThreadOwner & {id: string};
	removedThreadId?: string;
	connection?: object;
	settlements: Set<Promise<void>>;
}

interface LeaseCheck {
	session?: boolean;
	cancelling?: boolean;
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
	const leases = new WeakMap<AnyLease, LeaseState>();
	const epochs = new Map<string, number>();
	let disposed = false;
	const projectOwner = (projectId: string, requireExecution = true) => {
		const project = options.getProject(projectId);
		if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
		if (
			requireExecution &&
			(!project.trusted || project.sessionCwd !== project.canonicalRoot)
		)
			throw denied();
		return project;
	};
	const current = (lease: AnyLease, check: LeaseCheck = {}) => {
		const state = leases.get(lease);
		if (!state || state.lease !== lease)
			throw new IpcFailure('DENIED', 'Invalid project operation');
		if (
			disposed ||
			state.abort.signal.aborted ||
			slots.get(lease.projectId) !== state ||
			(epochs.get(lease.projectId) ?? 0) !== lease.epoch
		)
			throw unavailable();
		const project = projectOwner(
			lease.projectId,
			lease[access] === 'execution' && !check.cancelling,
		);
		if (
			project.canonicalRoot !== lease.canonicalRoot ||
			project.sessionCwd !== state.sessionCwd
		)
			throw denied();
		if (state.thread) {
			const thread = options.getThread(lease.projectId, state.thread.id);
			if (!thread) throw new IpcFailure('NOT_FOUND', 'Thread not found');
			if (
				state.removedThreadId !== undefined ||
				thread.sessionCwd !== state.thread.sessionCwd ||
				(check.session !== false &&
					thread.nanocoderSessionId !== state.thread.nanocoderSessionId)
			)
				throw denied();
		}
		if (
			state.connection &&
			options.getConnection(lease.projectId) !== state.connection &&
			!(
				check.cancelling && options.getConnection(lease.projectId) === undefined
			)
		)
			throw unavailable();
		return state;
	};
	const executionState = (
		lease: ProjectOperationLease,
		checkSession = true,
	) => {
		if (lease[access] !== 'execution') throw denied();
		return current(lease, {session: checkSession});
	};
	const metadataState = (lease: MetadataOperationLease) => {
		if (lease[access] !== 'metadata') throw denied();
		return current(lease);
	};
	const confirmationState = (lease: PendingProjectOperationLease) => {
		if (lease[access] !== 'confirmation') throw denied();
		return current(lease);
	};
	const invalidate = (projectId: string, settlement?: Promise<unknown>) => {
		const observed = settlement && observe(settlement);
		epochs.set(projectId, (epochs.get(projectId) ?? 0) + 1);
		const state = slots.get(projectId);
		if (!state) return;
		if (observed) state.settlements.add(observed);
		state.abort.abort(unavailable());
	};
	const bind = (lease: AnyLease, threadId: string) => {
		const state = current(lease);
		if (state.thread && state.thread.id !== threadId) throw denied();
		const thread = options.getThread(lease.projectId, threadId);
		if (!thread) throw new IpcFailure('NOT_FOUND', 'Thread not found');
		if (
			lease[access] === 'execution' &&
			thread.sessionCwd !== lease.canonicalRoot
		)
			throw denied();
		state.thread = {...thread, id: threadId};
	};
	const run = async <T>(
		projectId: string,
		kind: string,
		permission: Access,
		work: (lease: AnyLease) => Promise<T>,
		scope: OperationScope = {},
	): Promise<T> => {
		if (disposed || scope.signal?.aborted) throw unavailable();
		if (slots.has(projectId))
			throw new IpcFailure('BUSY', 'Wait for this project to finish', true);
		const project = projectOwner(projectId, permission === 'execution');
		const abort = new AbortController();
		const owner: LeaseOwner = {
			projectId,
			kind,
			epoch: epochs.get(projectId) ?? 0,
			canonicalRoot: project.canonicalRoot,
			signal: abort.signal,
		};
		const lease: AnyLease =
			permission === 'execution'
				? Object.freeze({...owner, [access]: 'execution' as const})
				: permission === 'metadata'
					? Object.freeze({...owner, [access]: 'metadata' as const})
					: Object.freeze({...owner, [access]: 'confirmation' as const});
		const state: LeaseState = {
			lease,
			abort,
			sessionCwd: project.sessionCwd,
			settlements: new Set(),
		};
		slots.set(projectId, state);
		leases.set(lease, state);
		const onAbort = () => {
			if (slots.get(projectId) === state) invalidate(projectId);
		};
		scope.signal?.addEventListener('abort', onAbort, {once: true});
		try {
			if (scope.threadId !== undefined) bind(lease, scope.threadId);
			current(lease);
			const result = await work(lease);
			if (state.removedThreadId !== undefined) {
				if (options.getThread(projectId, state.removedThreadId)) throw denied();
			} else current(state.lease);
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
	};
	const authority = {
		runProjectOperation: <T>(
			projectId: string,
			kind: string,
			work: (lease: ProjectOperationLease) => Promise<T>,
			scope: OperationScope = {},
		): Promise<T> =>
			run(
				projectId,
				kind,
				'execution',
				lease => {
					if (lease[access] !== 'execution') throw denied();
					return work(lease);
				},
				scope,
			),
		runMetadataOperation: <T>(
			projectId: string,
			kind:
				| 'archive-thread'
				| 'remove-thread'
				| 'rename-unsaved-thread'
				| 'import-session',
			work: (lease: MetadataOperationLease) => Promise<T>,
			scope: OperationScope = {},
		): Promise<T> =>
			run(
				projectId,
				kind,
				'metadata',
				lease => {
					if (lease[access] !== 'metadata') throw denied();
					return work(lease);
				},
				scope,
			),
		runConfirmationOperation: <T>(
			projectId: string,
			kind: 'delete-history',
			work: (lease: PendingProjectOperationLease) => Promise<T>,
			scope: OperationScope = {},
		): Promise<T> =>
			run(
				projectId,
				kind,
				'confirmation',
				lease => {
					if (lease[access] !== 'confirmation') throw denied();
					return work(lease);
				},
				scope,
			),
		runConfirmationStep: async <T>(
			lease: PendingProjectOperationLease,
			work: () => Promise<T>,
		): Promise<T> => {
			confirmationState(lease);
			const result = await untilAborted(work(), lease.signal);
			confirmationState(lease);
			return result;
		},
		confirmExecution: (
			pending: PendingProjectOperationLease,
		): ProjectOperationLease => {
			const state = confirmationState(pending);
			projectOwner(pending.projectId);
			if (state.thread && state.thread.sessionCwd !== pending.canonicalRoot)
				throw denied();
			const lease: ProjectOperationLease = Object.freeze({
				...pending,
				[access]: 'execution' as const,
			});
			state.lease = lease;
			leases.set(lease, state);
			executionState(lease);
			return lease;
		},
		assertMetadataCurrent: (lease: MetadataOperationLease) => {
			metadataState(lease);
		},
		removeOwnedThread: (
			lease: ProjectOperationLease | MetadataOperationLease,
			remove: () => undefined,
		) => {
			if (lease[access] !== 'execution' && lease[access] !== 'metadata')
				throw denied();
			const state = current(lease);
			if (!state.thread) throw denied();
			remove();
			if (options.getThread(lease.projectId, state.thread.id)) throw denied();
			state.removedThreadId = state.thread.id;
		},
		isBusy: (projectId: string) => slots.has(projectId),
		runCancellationStep: async <T>(
			lease: ProjectOperationLease,
			work: () => Promise<T>,
		): Promise<T> => {
			if (lease[access] !== 'execution' || lease.kind !== 'prompt')
				throw denied();
			const state = current(lease, {cancelling: true});
			if (!state.thread) throw denied();
			const connection = options.getConnection(lease.projectId);
			const check = () => {
				current(lease, {cancelling: true});
				const latest = options.getConnection(lease.projectId);
				if (latest !== undefined && latest !== connection) throw unavailable();
			};
			const pending = work();
			state.settlements.add(observe(pending));
			let result: T;
			try {
				result = await pending;
			} catch (error) {
				check();
				throw error;
			}
			check();
			return result;
		},
		runOwnedStep: async <T>(
			lease: ProjectOperationLease,
			work: () => Promise<T>,
		): Promise<T> => {
			const state = executionState(lease);
			const pending = work();
			state.settlements.add(observe(pending));
			let result: T;
			try {
				result = await pending;
			} catch (error) {
				executionState(lease);
				throw error;
			}
			executionState(lease);
			return result;
		},
		assertCurrent: (lease: ProjectOperationLease) => {
			executionState(lease);
		},
		bindThread: (lease: ProjectOperationLease, threadId: string) => {
			executionState(lease);
			bind(lease, threadId);
		},
		bindSession: (lease: ProjectOperationLease, sessionId: string) => {
			const state = executionState(lease, false);
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
			const state = executionState(lease);
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
