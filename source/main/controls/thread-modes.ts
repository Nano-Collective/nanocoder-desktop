import type {ControlSessionContext} from '@/main/controls/project-controls';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {NanocoderConnection} from '@/main/nanocoder/acp-client';
import {sessionModeOptions} from '@/main/nanocoder/control-options';
import {canonicalPath} from '@/main/paths';
import type {
	createProjectOperations,
	ProjectOperationLease,
} from '@/main/threads/project-operations';
import type {
	NanocoderMode,
	ProjectInfo,
	ThreadInfo,
	WorkspaceRequests,
} from '@/shared/ipc';

interface ThreadModeOptions {
	operations: ReturnType<typeof createProjectOperations>;
	runProjectOperation: ReturnType<
		typeof createProjectOperations
	>['runProjectOperation'];
	getProject(projectId: string): ProjectInfo | undefined;
	getThread(projectId: string, threadId: string): ThreadInfo | undefined;
	getConnection(projectId: string): NanocoderConnection | undefined;
	saveThread(thread: ThreadInfo): void;
	saveProject(project: ProjectInfo): void;
	publishThread(thread: ThreadInfo): void;
	publishProject(project: ProjectInfo): void;
	canonicalise?(path: string): Promise<string>;
	confirmYolo?(snapshot: {
		project: ProjectInfo;
		thread: ThreadInfo;
	}): Promise<boolean>;
}

interface PendingMode {
	projectId: string;
	threadId: string;
	mode: NanocoderMode;
	root: string;
	epoch: number;
	connection: NanocoderConnection | undefined;
	attempt?: ProjectOperationLease;
	prepared?: {sessionId: string; connection: NanocoderConnection};
}
interface LiveMode {
	projectId: string;
	threadId: string;
	sessionId: string;
	connection: NanocoderConnection;
	mode: NanocoderMode;
	root: string;
	epoch: number;
}
const keyFor = (projectId: string, threadId: string) =>
	JSON.stringify([projectId, threadId]);
const knownMode = (value: unknown): value is NanocoderMode =>
	sessionModeOptions([{id: value}]).length === 1;
const staleChoice =
	'the pending mode choice expired; select the mode again before sending';

export function createThreadModes(options: ThreadModeOptions) {
	const operations = options.operations;
	const pending = new Map<string, PendingMode>();
	const live = new Map<string, LiveMode>();
	const dropped = new Map<string, string>();
	let disposed = false;
	const project = (projectId: string) => {
		if (disposed)
			throw new IpcFailure('AGENT_UNAVAILABLE', 'Mode controls stopped');
		const owner = options.getProject(projectId);
		if (!owner) throw new IpcFailure('NOT_FOUND', 'Project not found');
		return owner;
	};
	const thread = (projectId: string, threadId: string) => {
		project(projectId);
		const row = options.getThread(projectId, threadId);
		if (!row || row.projectId !== projectId)
			throw new IpcFailure('NOT_FOUND', 'Thread not found');
		return row;
	};
	const mutable = (row: ThreadInfo) => {
		if (row.archiveState !== 'active' || row.runState === 'view-only')
			throw new IpcFailure('DENIED', 'This thread cannot change mode');
	};
	const forgetPending = (key: string) => {
		if (pending.delete(key)) dropped.set(key, staleChoice);
	};
	const currentAttempt = (choice: PendingMode) => {
		if (!choice.attempt) return true;
		try {
			operations.assertCurrent(choice.attempt);
			return true;
		} catch {
			return false;
		}
	};
	const scoped = (owner: ProjectInfo, root: string) =>
		owner.trusted &&
		owner.availability === 'available' &&
		owner.canonicalRoot === root &&
		owner.sessionCwd === root;
	const resolveLiveMode = (
		projectId: string,
		threadId: string,
		sessionId: string | null,
		connection: NanocoderConnection | undefined,
	): NanocoderMode | undefined => {
		if (disposed) return undefined;
		const owner = options.getProject(projectId);
		const row = options.getThread(projectId, threadId);
		if (!owner || !row || row.projectId !== projectId) return undefined;
		const key = keyFor(projectId, threadId);
		if (sessionId === null && row.nanocoderSessionId === null) {
			const choice = pending.get(key);
			if (
				choice &&
				scoped(owner, choice.root) &&
				row.sessionCwd === choice.root &&
				currentAttempt(choice) &&
				(choice.connection === connection ||
					(choice.connection === undefined && !!choice.attempt)) &&
				options.getConnection(projectId) === connection
			)
				return choice.mode;
			forgetPending(key);
			return undefined;
		}
		const acknowledged = live.get(key);
		if (
			acknowledged &&
			scoped(owner, acknowledged.root) &&
			row.sessionCwd === acknowledged.root &&
			row.nanocoderSessionId === sessionId &&
			acknowledged.sessionId === sessionId &&
			acknowledged.connection === connection &&
			options.getConnection(projectId) === connection &&
			connection?.getSessionOffers(sessionId ?? '')
		)
			return acknowledged.mode;
		return undefined;
	};
	const present = (row: ThreadInfo): ThreadInfo => ({
		...row,
		mode:
			resolveLiveMode(
				row.projectId,
				row.id,
				row.nanocoderSessionId,
				options.getConnection(row.projectId),
			) ??
			(row.mode === 'yolo' ? project(row.projectId).defaultMode : row.mode),
	});
	const saveSafeMode = (
		projectId: string,
		threadId: string,
		mode: NanocoderMode,
	) => {
		const row = thread(projectId, threadId);
		if (mode !== 'yolo' && row.mode !== mode)
			options.saveThread({...row, mode});
		return thread(projectId, threadId);
	};
	const validateRoot = async (lease: ProjectOperationLease) => {
		let root: string;
		try {
			root = await operations.runOwnedStep(lease, () =>
				(options.canonicalise ?? canonicalPath)(lease.canonicalRoot),
			);
		} catch (error) {
			if (error instanceof IpcFailure) throw error;
			throw new IpcFailure(
				'DENIED',
				'The project root changed; locate and trust it again',
			);
		}
		if (root !== lease.canonicalRoot)
			throw new IpcFailure(
				'DENIED',
				'The project root changed; locate and trust it again',
			);
		operations.assertCurrent(lease);
	};
	const bindContext = (context: ControlSessionContext) => {
		const {lease, connection, session} = context;
		if (context.thread.projectId !== lease.projectId)
			throw new IpcFailure('DENIED', staleChoice);
		operations.assertCurrent(lease);
		operations.bindThread(lease, context.thread.id);
		operations.bindConnection(lease, connection);
		operations.bindSession(lease, session.id);
		const row = thread(lease.projectId, context.thread.id);
		mutable(row);
		if (
			!scoped(project(lease.projectId), lease.canonicalRoot) ||
			row.nanocoderSessionId !== session.id ||
			connection.agent.root !== lease.canonicalRoot
		)
			throw new IpcFailure('DENIED', staleChoice);
		return row;
	};
	const rememberLive = (
		context: ControlSessionContext,
		mode: NanocoderMode,
	) => {
		const key = keyFor(context.thread.projectId, context.thread.id);
		const acknowledged: LiveMode = {
			projectId: context.thread.projectId,
			threadId: context.thread.id,
			sessionId: context.session.id,
			connection: context.connection,
			mode,
			root: context.lease.canonicalRoot,
			epoch: context.lease.epoch,
		};
		live.set(key, acknowledged);
		context.lease.signal.addEventListener(
			'abort',
			() => {
				if (live.get(key) === acknowledged) live.delete(key);
				if (pending.get(key)?.attempt === context.lease) forgetPending(key);
			},
			{once: true},
		);
	};
	const validateBeforePrepare = (
		lease: ProjectOperationLease,
		input: ThreadInfo,
	) => {
		operations.assertCurrent(lease);
		if (lease.projectId !== input.projectId)
			throw new IpcFailure('DENIED', staleChoice);
		operations.bindThread(lease, input.id);
		const row = thread(input.projectId, input.id);
		mutable(row);
		const key = keyFor(input.projectId, input.id);
		const choice = pending.get(key);
		if (
			choice &&
			(choice.epoch !== lease.epoch ||
				!scoped(project(input.projectId), choice.root) ||
				row.nanocoderSessionId !== null ||
				!currentAttempt(choice) ||
				(choice.connection !== options.getConnection(input.projectId) &&
					!choice.attempt))
		)
			forgetPending(key);
		if (dropped.has(key))
			throw new IpcFailure('DENIED', dropped.get(key) ?? staleChoice);
		const activeChoice = pending.get(key);
		if (activeChoice) {
			activeChoice.attempt = lease;
			lease.signal.addEventListener(
				'abort',
				() => {
					if (pending.get(key) === activeChoice) forgetPending(key);
				},
				{once: true},
			);
		}
	};
	const onSessionPrepared = (context: ControlSessionContext) => {
		const row = bindContext(context);
		const {session, connection, lease} = context;
		const offers = connection.getSessionOffers(session.id);
		if (
			session.mode === 'yolo' ||
			!knownMode(session.mode) ||
			!offers?.offeredModes.includes(session.mode)
		)
			throw new IpcFailure(
				'DENIED',
				'A session must first acknowledge a safe offered mode',
			);
		rememberLive(context, session.mode);
		const choice = pending.get(keyFor(row.projectId, row.id));
		if (choice) {
			if (
				context.source !== 'new' ||
				choice.attempt !== lease ||
				choice.epoch !== lease.epoch ||
				choice.root !== lease.canonicalRoot ||
				(choice.connection && choice.connection !== connection)
			) {
				forgetPending(keyFor(row.projectId, row.id));
				throw new IpcFailure('DENIED', staleChoice);
			}
			choice.prepared = {sessionId: session.id, connection};
		}
	};
	return {
		resolveLiveMode,
		validateBeforePrepare,
		onSessionPrepared,
		beforeFirstPrompt: async (context: ControlSessionContext) => {
			const row = bindContext(context);
			const key = keyFor(row.projectId, row.id);
			if (dropped.has(key))
				throw new IpcFailure('DENIED', dropped.get(key) ?? staleChoice);
			const acknowledged = live.get(key);
			if (
				!acknowledged ||
				acknowledged.epoch !== context.lease.epoch ||
				resolveLiveMode(
					row.projectId,
					row.id,
					context.session.id,
					context.connection,
				) === undefined
			)
				throw new IpcFailure(
					'AGENT_UNAVAILABLE',
					'The session mode must be safely prepared again',
				);
			const choice = pending.get(key);
			if (!choice) return;
			pending.delete(key);
			let changingMode = false;
			try {
				if (
					choice.attempt !== context.lease ||
					choice.epoch !== context.lease.epoch ||
					choice.prepared?.connection !== context.connection ||
					choice.prepared.sessionId !== context.session.id ||
					!context.connection
						.getSessionOffers(context.session.id)
						?.offeredModes.includes(choice.mode)
				)
					throw new IpcFailure(
						'DENIED',
						'Nanocoder did not offer the pending mode; select a mode again',
					);
				if (choice.mode !== acknowledged.mode) {
					changingMode = true;
					const result = await operations.runOwnedStep(context.lease, () =>
						context.connection.setMode(context.session.id, choice.mode),
					);
					if (result.id !== context.session.id || result.mode !== choice.mode)
						throw new IpcFailure(
							'AGENT_UNAVAILABLE',
							'Nanocoder did not acknowledge the selected mode',
						);
				}
				bindContext(context);
				saveSafeMode(row.projectId, row.id, choice.mode);
				rememberLive(context, choice.mode);
				dropped.delete(key);
				options.publishThread(present(thread(row.projectId, row.id)));
			} catch (error) {
				dropped.set(key, staleChoice);
				if (
					changingMode ||
					!context.connection.getSessionOffers(context.session.id)
				)
					live.delete(key);
				if (error instanceof IpcFailure) throw error;
				throw new IpcFailure(
					'AGENT_UNAVAILABLE',
					'Nanocoder did not set the selected mode; select it again',
				);
			}
		},
		setThreadMode: (
			request: WorkspaceRequests['setThreadMode'],
		): Promise<ThreadInfo> =>
			options.runProjectOperation(
				request.projectId,
				'mode',
				async lease => {
					let row = thread(request.projectId, request.threadId);
					mutable(row);
					if (!knownMode(request.mode))
						throw new IpcFailure('DENIED', 'Choose a known mode');
					const key = keyFor(row.projectId, row.id);
					if (pending.get(key)?.mode !== request.mode) forgetPending(key);
					const connection = options.getConnection(row.projectId);
					if (connection) operations.bindConnection(lease, connection);
					await validateRoot(lease);
					row = thread(row.projectId, row.id);
					mutable(row);
					let currentMode = resolveLiveMode(
						row.projectId,
						row.id,
						row.nanocoderSessionId,
						connection,
					);
					if (
						row.nanocoderSessionId !== null &&
						currentMode === undefined &&
						request.mode === 'yolo'
					)
						throw new IpcFailure(
							'UNAVAILABLE',
							'Resume this thread before choosing yolo',
						);
					if (
						row.nanocoderSessionId !== null &&
						currentMode !== undefined &&
						!connection
							?.getSessionOffers(row.nanocoderSessionId)
							?.offeredModes.includes(request.mode)
					)
						throw new IpcFailure('DENIED', 'Nanocoder did not offer this mode');
					if (request.mode === 'yolo') {
						if (!options.confirmYolo)
							throw new IpcFailure(
								'DENIED',
								'Yolo requires confirmation in the main process',
							);
						let confirmed: boolean;
						try {
							confirmed =
								(await operations.runOwnedStep(lease, () =>
									Promise.resolve(
										options.confirmYolo?.(
											structuredClone({
												project: project(row.projectId),
												thread: present(row),
											}),
										),
									),
								)) === true;
						} catch (error) {
							if (error instanceof IpcFailure) throw error;
							throw new IpcFailure(
								'AGENT_UNAVAILABLE',
								'The mode confirmation could not finish',
							);
						}
						if (options.getConnection(row.projectId) !== connection)
							throw new IpcFailure('DENIED', staleChoice);
						row = thread(row.projectId, row.id);
						mutable(row);
						if (!confirmed) return present(row);
						await validateRoot(lease);
						row = thread(row.projectId, row.id);
						mutable(row);
						if (options.getConnection(row.projectId) !== connection)
							throw new IpcFailure('DENIED', staleChoice);
						if (row.nanocoderSessionId !== null) {
							currentMode = resolveLiveMode(
								row.projectId,
								row.id,
								row.nanocoderSessionId,
								connection,
							);
							if (
								currentMode === undefined ||
								!connection
									?.getSessionOffers(row.nanocoderSessionId)
									?.offeredModes.includes(request.mode)
							)
								throw new IpcFailure(
									'DENIED',
									'Nanocoder did not offer this mode',
								);
						}
					}
					operations.assertCurrent(lease);
					dropped.delete(key);
					if (row.nanocoderSessionId === null) {
						pending.set(key, {
							projectId: row.projectId,
							threadId: row.id,
							mode: request.mode,
							root: lease.canonicalRoot,
							epoch: lease.epoch,
							connection,
						});
						saveSafeMode(row.projectId, row.id, request.mode);
					} else if (currentMode !== undefined && connection) {
						const sessionId = row.nanocoderSessionId;
						const context: ControlSessionContext = {
							lease,
							thread: row,
							connection,
							session: {id: sessionId, mode: currentMode},
							source: 'resume',
						};
						if (currentMode !== request.mode || request.mode === 'yolo') {
							live.delete(key);
							try {
								const result = await operations.runOwnedStep(lease, () =>
									connection.setMode(sessionId, request.mode),
								);
								if (result.id !== sessionId || result.mode !== request.mode)
									throw new IpcFailure(
										'AGENT_UNAVAILABLE',
										'Nanocoder did not acknowledge the selected mode',
									);
								mutable(thread(row.projectId, row.id));
							} catch (error) {
								if (error instanceof IpcFailure) throw error;
								throw new IpcFailure(
									'AGENT_UNAVAILABLE',
									'Nanocoder did not set the selected mode',
								);
							}
						}
						saveSafeMode(row.projectId, row.id, request.mode);
						rememberLive(context, request.mode);
					} else saveSafeMode(row.projectId, row.id, request.mode);
					const result = present(thread(row.projectId, row.id));
					options.publishThread(result);
					return result;
				},
				{threadId: request.threadId},
			),
		setProjectDefaultMode: (
			request: WorkspaceRequests['setProjectDefaultMode'],
		): Promise<ProjectInfo> =>
			options.runProjectOperation(
				request.projectId,
				'default-mode',
				async lease => {
					const mode: unknown = request.mode;
					if (!knownMode(mode) || mode === 'yolo')
						throw new IpcFailure('DENIED', 'Yolo cannot be a project default');
					await validateRoot(lease);
					const result = {
						...project(request.projectId),
						defaultMode: mode,
					};
					options.saveProject(result);
					options.publishProject(result);
					return structuredClone(result);
				},
			),
		invalidate(projectId: string) {
			for (const [key, choice] of pending)
				if (choice.projectId === projectId) forgetPending(key);
			for (const [key, acknowledged] of live)
				if (acknowledged.projectId === projectId) live.delete(key);
		},
		invalidateThread(projectId: string, threadId: string) {
			const key = keyFor(projectId, threadId);
			forgetPending(key);
			live.delete(key);
		},
		dispose() {
			disposed = true;
			pending.clear();
			live.clear();
			dropped.clear();
		},
	};
}
