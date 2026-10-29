import {stat} from 'node:fs/promises';
import path from 'node:path';
import {IpcFailure} from '@/main/ipc/handle-request';
import {untilAborted} from '@/main/nanocoder/abort';
import {
	type ConnectOptions,
	type NanocoderConnection,
	NanocoderFailure,
	type ResumedSession,
} from '@/main/nanocoder/acp-client';
import {capabilityGates, describeAgent} from '@/main/nanocoder/capabilities';
import {type SupervisorClock, systemClock} from '@/main/nanocoder/clock';
import {
	DiagnosticSnapshots,
	diagnosticLine,
} from '@/main/nanocoder/diagnostics';
import {connectProject} from '@/main/nanocoder/open-project';
import {PermissionBroker} from '@/main/nanocoder/permissions';
import type {Resolution} from '@/main/nanocoder/runtime';
import {redact, StderrRing} from '@/main/nanocoder/stderr-ring';
import type {NanocoderSupervisor} from '@/main/nanocoder/supervisor-contracts';
import type {TrustRefusal} from '@/main/nanocoder/trust';
import {toTurnEvent} from '@/main/nanocoder/turn-events';
import {versionPolicy} from '@/main/nanocoder/version-policy';
import {canonicalPath, isInside} from '@/main/paths';
import type {
	CapabilityGates,
	DiagnosticsSnapshot,
	ProjectEvent,
	ProjectInfo,
	SupervisorState,
	TurnEvent,
	TurnResult,
} from '@/shared/ipc';

interface Entry {
	project: ProjectInfo;
	state: SupervisorState;
	abort: AbortController;
	connection?: NanocoderConnection;
	starting?: Promise<SupervisorState>;
	stopping?: Promise<SupervisorState>;
	permissions: Map<string, PermissionBroker>;
	activeTurn?: {sessionId: string; cancelled: boolean; settled: Promise<void>};
	cancelRetry?: () => void;
	cancelIdle?: () => void;
	lastActivityAt: number;
	diagnostics: StderrRing;
	diagnosticsTruncated: boolean;
	stderr: StderrRing;
	diagnosticsRetained: boolean;
	stopVersion: number;
	idleStopping?: boolean;
}

export interface ProjectActivity {
	runningTurn: boolean;
	openSessions: number;
	preparing: boolean;
	lastActivityAt: number;
}

interface SupervisorOptions {
	resolveRuntime(root: string, signal: AbortSignal): Promise<Resolution>;
	clientInfo: ConnectOptions['clientInfo'];
	confirmTrust(refusal: TrustRefusal, canonicalRoot: string): Promise<boolean>;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	connect?: typeof connectProject;
	clock?: SupervisorClock;
	idleTimeoutMs?: number;
	activity?: (projectId: string) => ProjectActivity;
	recover?: (
		project: ProjectInfo,
		connection: NanocoderConnection,
		signal: AbortSignal,
	) => Promise<ResumedSession | void>;
}

const stopped = (projectId: string): SupervisorState => ({
	projectId,
	status: 'stopped',
	reason: null,
	runtime: null,
	agent: null,
	gates: null,
	activeThreadId: null,
	exit: null,
	restart: {attempt: 0, limit: 0, nextAttemptAt: null},
});

export class ProjectSupervisor implements NanocoderSupervisor {
	private readonly entries = new Map<string, Entry>();
	private readonly listeners = new Set<(event: ProjectEvent) => void>();
	private readonly sequences = new Map<string, number>();
	private readonly turnSequences = new Map<string, Map<string, number>>();
	private closed = false;
	private closing?: Promise<void>;
	private permissionCounter = 0;
	private readonly snapshots: DiagnosticSnapshots;

	constructor(private readonly options: SupervisorOptions) {
		this.snapshots = new DiagnosticSnapshots({clock: options.clock});
	}

	private get clock(): SupervisorClock {
		return this.options.clock ?? systemClock;
	}

	private get idleTimeoutMs(): number {
		return this.options.idleTimeoutMs ?? 300_000;
	}

	private scheduleIdle(entry: Entry, delay = this.idleTimeoutMs): void {
		if (
			!this.options.activity ||
			entry.abort.signal.aborted ||
			entry.state.status !== 'ready'
		)
			return;
		entry.cancelIdle?.();
		entry.cancelIdle = this.clock.setTimeout(() => {
			entry.cancelIdle = undefined;
			if (
				this.entries.get(entry.project.id) !== entry ||
				entry.abort.signal.aborted ||
				entry.state.status !== 'ready'
			)
				return;
			const activity = this.options.activity?.(entry.project.id);
			const timeout = this.idleTimeoutMs;
			if (
				!activity ||
				activity.runningTurn ||
				activity.openSessions > 0 ||
				activity.preparing ||
				entry.activeTurn
			) {
				this.scheduleIdle(entry);
				return;
			}
			const remaining =
				Math.max(entry.lastActivityAt, activity.lastActivityAt) +
				timeout -
				this.clock.now();
			if (remaining > 0) this.scheduleIdle(entry, remaining);
			else {
				entry.idleStopping = true;
				void this.stop(entry.project.id).catch(() => {});
			}
		}, delay);
	}

	private scheduleRetry(entry: Entry): void {
		const restart = entry.state.restart;
		if (
			this.closed ||
			entry.abort.signal.aborted ||
			restart.attempt >= restart.limit
		)
			return;
		const delay = 1000 * 2 ** restart.attempt;
		entry.state.restart = {
			...restart,
			attempt: restart.attempt + 1,
			nextAttemptAt: new Date(this.clock.now() + delay).toISOString(),
		};
		entry.cancelRetry = this.clock.setTimeout(() => {
			entry.cancelRetry = undefined;
			if (
				this.entries.get(entry.project.id) !== entry ||
				entry.abort.signal.aborted ||
				this.closed
			)
				return;
			entry.state.restart.nextAttemptAt = null;
			const refused = () => {
				if (
					this.entries.get(entry.project.id) !== entry ||
					entry.abort.signal.aborted
				)
					return;
				entry.state.reason =
					'Automatic recovery could not start. Retry when ready.';
				this.publish(entry);
			};
			try {
				void this.start(entry.project, true).catch(refused);
			} catch {
				refused();
			}
		}, delay);
	}

	subscribe(listener: (event: ProjectEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(event: ProjectEvent): void {
		for (const listener of this.listeners) listener(structuredClone(event));
	}

	private sequence(projectId: string): number {
		const value = (this.sequences.get(projectId) ?? 0) + 1;
		this.sequences.set(projectId, value);
		return value;
	}

	announceProject(project: ProjectInfo): void {
		this.emit({
			type: 'project',
			projectId: project.id,
			sequence: this.sequence(project.id),
			project,
		});
	}

	private publish(entry: Entry): void {
		this.emit({
			type: 'supervisor',
			projectId: entry.project.id,
			sequence: this.sequence(entry.project.id),
			state: entry.state,
		});
	}

	private retainDiagnostics(entry: Entry): void {
		if (entry.diagnosticsRetained) return;
		entry.diagnosticsRetained = true;
		entry.diagnosticsTruncated ||= entry.stderr.truncated;
		const root = redact(entry.project.canonicalRoot, this.options.homeDir);
		for (const line of entry.stderr.lines())
			entry.diagnostics.append(diagnosticLine(line, root));
	}

	private turn(entry: Entry, sessionId: string, event: TurnEvent): void {
		this.turnBatch(entry, sessionId, [event]);
	}

	private turnBatch(
		entry: Entry,
		sessionId: string,
		events: TurnEvent[],
	): void {
		const projectId = entry.project.id;
		let sequences = this.turnSequences.get(projectId);
		if (!sequences) {
			sequences = new Map();
			this.turnSequences.set(projectId, sequences);
		}
		const sequence = (sequences.get(sessionId) ?? 0) + 1;
		sequences.set(sessionId, sequence);
		// The technical gate has no stored threads; its session ID is its transient thread ID.
		this.emit({
			type: 'turn',
			projectId,
			threadId: sessionId,
			sequence,
			events,
		});
	}

	getState(projectId: string): SupervisorState {
		return structuredClone(
			this.entries.get(projectId)?.state ?? stopped(projectId),
		);
	}

	replayState(projectId: string): void {
		const entry = this.entries.get(projectId);
		if (entry) this.publish(entry);
	}

	getConnection(projectId: string): NanocoderConnection {
		const entry = this.entries.get(projectId);
		if (!entry?.connection || entry.state.status !== 'ready') {
			throw new IpcFailure(
				'AGENT_UNAVAILABLE',
				entry?.state.reason ?? 'No project process is ready',
			);
		}
		return entry.connection;
	}

	getCapabilityGates(projectId: string): CapabilityGates {
		const gates = this.entries.get(projectId)?.state.gates;
		if (!gates)
			throw new IpcFailure(
				'AGENT_UNAVAILABLE',
				'Connect to Nanocoder to check its features',
			);
		return structuredClone(gates);
	}

	ensureProcess(project: ProjectInfo): Promise<SupervisorState> {
		if (!project.trusted)
			throw new IpcFailure('DENIED', 'Trust this project before starting it');
		return this.start(project);
	}

	// Only main's native folder-picker flow can request DEC-30's pre-trust probe.
	probeProject(project: ProjectInfo): Promise<SupervisorState> {
		return this.start(project);
	}

	private start(
		project: ProjectInfo,
		recovering = false,
	): Promise<SupervisorState> {
		if (this.closed)
			throw new IpcFailure('AGENT_UNAVAILABLE', 'The desktop is shutting down');
		if (
			project.availability !== 'available' ||
			!path.isAbsolute(project.canonicalRoot)
		) {
			throw new IpcFailure(
				'DENIED',
				'The project root is unavailable or is not absolute',
			);
		}
		const existing = this.entries.get(project.id);
		if (
			existing &&
			(existing.starting ||
				existing.state.status === 'ready' ||
				existing.stopping)
		) {
			if (existing.project.canonicalRoot !== project.canonicalRoot) {
				throw new IpcFailure(
					'BUSY',
					'Stop this project before changing its root',
				);
			}
			if (existing.stopping && existing.idleStopping) {
				const version = existing.stopVersion;
				return existing.stopping.then(() => {
					if (existing.stopVersion !== version)
						throw new IpcFailure(
							'AGENT_UNAVAILABLE',
							'The project reopen was cancelled',
						);
					return this.start(project, recovering);
				});
			}
			if (existing.stopping)
				throw new IpcFailure('BUSY', 'The project is stopping');
			return existing.starting ?? Promise.resolve(this.getState(project.id));
		}
		for (const entry of this.entries.values()) {
			if (
				entry.project.id !== project.id &&
				entry.project.canonicalRoot === project.canonicalRoot &&
				(entry.starting || entry.connection || entry.stopping)
			) {
				throw new IpcFailure(
					'BUSY',
					'This canonical project root already has a process',
				);
			}
		}
		existing?.cancelRetry?.();
		existing?.cancelIdle?.();
		existing?.abort.abort(
			new NanocoderFailure('AGENT_UNAVAILABLE', 'The project process changed'),
		);
		const entry: Entry = {
			project: structuredClone(project),
			state: {
				...stopped(project.id),
				status: 'starting',
				restart: {
					...(existing?.state.restart ?? stopped(project.id).restart),
					nextAttemptAt: null,
				},
			},
			abort: new AbortController(),
			permissions: new Map(),
			lastActivityAt: this.clock.now(),
			diagnostics:
				existing?.diagnostics ??
				new StderrRing({homeDir: this.options.homeDir}),
			diagnosticsTruncated: existing?.diagnosticsTruncated ?? false,
			stderr: new StderrRing({homeDir: this.options.homeDir}),
			diagnosticsRetained: false,
			stopVersion: 0,
		};
		this.entries.set(project.id, entry);
		entry.starting = Promise.resolve()
			.then(() => this.launch(entry, recovering))
			.finally(() => {
				entry.starting = undefined;
			});
		this.publish(entry);
		return entry.starting;
	}

	private async launch(
		entry: Entry,
		recovering: boolean,
	): Promise<SupervisorState> {
		const {
			project,
			abort: {signal},
		} = entry;
		const validateRoot = async () => {
			const root = await untilAborted(
				canonicalPath(project.canonicalRoot),
				signal,
			);
			const info = await untilAborted(stat(root), signal);
			if (
				!info.isDirectory() ||
				root !== project.canonicalRoot ||
				project.sessionCwd !== root
			) {
				throw new IpcFailure(
					'DENIED',
					'The canonical project root changed; locate and trust the folder again',
				);
			}
			return root;
		};
		try {
			const root = await validateRoot();
			const resolved = await untilAborted(
				this.options.resolveRuntime(root, signal),
				signal,
			);
			if (!resolved.ok) throw new IpcFailure(resolved.code, resolved.message);
			entry.state.runtime = resolved.runtime;
			const policy = versionPolicy(resolved.runtime.version);
			if (policy.status === 'refused') {
				entry.state.gates = capabilityGates(
					project.id,
					describeAgent(root, {
						protocolVersion: 1,
						agentInfo: {name: 'nanocoder', version: resolved.runtime.version},
					}),
					{rename: false, timeline: false},
				);
				throw new NanocoderFailure('UNSUPPORTED', policy.reason);
			}
			const result = await (this.options.connect ?? connectProject)({
				runtime: resolved.runtime,
				root,
				signal,
				clientInfo: this.options.clientInfo,
				env: this.options.env,
				homeDir: this.options.homeDir,
				stderr: entry.stderr,
				confirmTrust: refusal => this.options.confirmTrust(refusal, root),
				beforeLaunch: async () => {
					await validateRoot();
					const paths = await untilAborted(
						Promise.all([
							canonicalPath(resolved.runtime.cliPath),
							canonicalPath(resolved.runtime.nodePath),
						]),
						signal,
					);
					if (
						paths[0] !== resolved.runtime.cliPath ||
						paths[1] !== resolved.runtime.nodePath ||
						paths.some(value => isInside(value, [root], process.platform))
					) {
						throw new IpcFailure(
							'DENIED',
							'The Nanocoder runtime changed or is inside the project folder',
						);
					}
				},
				onSessionUpdate: notification => {
					if (signal.aborted) return;
					entry.lastActivityAt = this.clock.now();
					const event = toTurnEvent(notification.update);
					if (event) this.turn(entry, notification.sessionId, event);
				},
				onPermission: request => {
					if (
						signal.aborted ||
						!entry.activeTurn ||
						entry.activeTurn.sessionId !== request.sessionId ||
						entry.activeTurn.cancelled
					)
						return Promise.resolve({outcome: {outcome: 'cancelled'}});
					let broker = entry.permissions.get(request.sessionId);
					if (!broker) {
						broker = new PermissionBroker(
							event => this.turn(entry, request.sessionId, event),
							() => `permission-${++this.permissionCounter}`,
						);
						entry.permissions.set(request.sessionId, broker);
					}
					return broker.request(request);
				},
			});
			if ('status' in result) {
				entry.state = {
					...entry.state,
					status: 'untrusted',
					reason: result.message,
				};
			} else {
				entry.connection = result;
				signal.throwIfAborted();
				entry.state.agent = result.agent;
				const negotiatedPolicy = versionPolicy(result.agent.version);
				entry.state.gates = capabilityGates(
					project.id,
					result.agent,
					negotiatedPolicy.status === 'refused'
						? {rename: false, timeline: false}
						: await untilAborted(result.probeExtensions(), signal),
				);
				if (negotiatedPolicy.status === 'refused') {
					throw new NanocoderFailure('UNSUPPORTED', negotiatedPolicy.reason);
				}
				if (recovering && this.options.recover) {
					const restored = await untilAborted(
						this.options.recover(project, result, signal),
						signal,
					);
					if (restored)
						this.turnBatch(entry, restored.session.id, restored.history);
				}
				signal.throwIfAborted();
				entry.state = {
					...entry.state,
					status: 'ready',
					reason: null,
					restart: {...entry.state.restart, limit: 3, nextAttemptAt: null},
				};
				this.scheduleIdle(entry);
				this.emit({
					type: 'capabilities',
					projectId: project.id,
					sequence: this.sequence(project.id),
					gates: this.getCapabilityGates(project.id),
				});
				void result.exited.then(exit => {
					if (entry.connection !== result || signal.aborted) return;
					this.retainDiagnostics(entry);
					entry.cancelIdle?.();
					entry.cancelIdle = undefined;
					entry.connection = undefined;
					if (entry.activeTurn) entry.activeTurn.cancelled = true;
					for (const broker of entry.permissions.values()) broker.cancelAll();
					entry.state = {
						...entry.state,
						status: 'failed',
						exit,
						activeThreadId: null,
						reason:
							'Nanocoder stopped. Start the project again when you are ready.',
					};
					this.scheduleRetry(entry);
					this.publish(entry);
				});
			}
		} catch (error) {
			await entry.connection?.close();
			this.retainDiagnostics(entry);
			entry.connection = undefined;
			if (!signal.aborted) {
				entry.state = {
					...entry.state,
					status:
						error instanceof NanocoderFailure && error.trust
							? 'untrusted'
							: error instanceof NanocoderFailure &&
									error.code === 'UNSUPPORTED'
								? 'unsupported'
								: 'failed',
					reason:
						error instanceof IpcFailure || error instanceof NanocoderFailure
							? error.message
							: 'The project could not start; check its folder and Nanocoder runtime',
				};
			}
		}
		if (!signal.aborted) this.publish(entry);
		return this.getState(project.id);
	}

	async prompt(
		projectId: string,
		sessionId: string,
		text: string,
	): Promise<TurnResult> {
		const connection = this.getConnection(projectId);
		const entry = this.entries.get(projectId);
		if (!entry) throw new IpcFailure('AGENT_UNAVAILABLE', 'No project is open');
		entry.lastActivityAt = this.clock.now();
		if (entry.activeTurn)
			throw new IpcFailure(
				'BUSY',
				'Nanocoder is already working on a turn',
				true,
			);
		let settle!: () => void;
		const turn = {
			sessionId,
			cancelled: false,
			settled: new Promise<void>(resolve => {
				settle = resolve;
			}),
		};
		entry.activeTurn = turn;
		entry.state.activeThreadId = sessionId;
		this.publish(entry);
		try {
			if (turn.cancelled) return {stopReason: 'cancelled'};
			return await connection.prompt(sessionId, text);
		} finally {
			if (entry.activeTurn === turn) {
				entry.activeTurn = undefined;
				entry.lastActivityAt = this.clock.now();
				entry.state.activeThreadId = null;
				if (!entry.abort.signal.aborted) this.publish(entry);
			}
			settle();
		}
	}

	answerPermission(
		projectId: string,
		sessionId: string,
		id: string,
		optionId: string,
	): boolean {
		return (
			this.entries
				.get(projectId)
				?.permissions.get(sessionId)
				?.answer(id, optionId) ?? false
		);
	}

	async cancel(projectId: string, sessionId: string): Promise<void> {
		const connection = this.getConnection(projectId);
		const entry = this.entries.get(projectId);
		const turn = entry?.activeTurn;
		if (!turn || turn.sessionId !== sessionId) return;
		turn.cancelled = true;
		entry?.permissions.get(sessionId)?.cancelAll();
		try {
			await connection.cancel(sessionId);
		} finally {
			await turn.settled;
		}
	}

	stop(projectId: string): Promise<SupervisorState> {
		const entry = this.entries.get(projectId);
		if (!entry) return Promise.resolve(stopped(projectId));
		entry.stopVersion++;
		if (entry.stopping) return entry.stopping;
		entry.cancelRetry?.();
		entry.cancelRetry = undefined;
		entry.cancelIdle?.();
		entry.cancelIdle = undefined;
		entry.state.restart.nextAttemptAt = null;
		entry.state = {...entry.state, status: 'stopping', reason: null};
		entry.stopping = Promise.resolve()
			.then(async () => {
				const results = await Promise.allSettled([
					Promise.resolve().then(() => entry.connection?.close()),
					entry.starting,
				]);
				this.retainDiagnostics(entry);
				entry.connection = undefined;
				entry.permissions.clear();
				entry.activeTurn = undefined;
				entry.state = {...entry.state, status: 'stopped', activeThreadId: null};
				this.publish(entry);
				const errors = results.filter(result => result.status === 'rejected');
				if (errors.length)
					throw new AggregateError(
						errors.map(result => result.reason),
						'Nanocoder did not stop cleanly',
					);
				return this.getState(projectId);
			})
			.finally(() => {
				entry.stopping = undefined;
				entry.idleStopping = false;
			});
		for (const broker of entry.permissions.values()) broker.cancelAll();
		entry.abort.abort(
			new NanocoderFailure('AGENT_UNAVAILABLE', 'The project is stopping'),
		);
		this.publish(entry);
		return entry.stopping;
	}

	async restart(project: ProjectInfo): Promise<SupervisorState> {
		const entry = this.entries.get(project.id);
		if (
			!entry ||
			entry.project.canonicalRoot !== project.canonicalRoot ||
			entry.project.sessionCwd !== project.sessionCwd
		) {
			throw new IpcFailure('NOT_FOUND', 'The project process is not available');
		}
		await this.stop(project.id);
		entry.state.restart = {attempt: 0, limit: 0, nextAttemptAt: null};
		return this.start(entry.project, true);
	}

	getDiagnostics(projectId: string): DiagnosticsSnapshot {
		const entry = this.entries.get(projectId);
		if (!entry) throw new IpcFailure('NOT_FOUND', 'Project not found');
		const ring = new StderrRing({homeDir: this.options.homeDir});
		for (const line of [
			...entry.diagnostics.lines(),
			...(entry.diagnosticsRetained ? [] : entry.stderr.lines()),
		])
			ring.append(
				diagnosticLine(
					line,
					redact(entry.project.canonicalRoot, this.options.homeDir),
				),
			);
		return this.snapshots.capture(
			projectId,
			ring.lines(),
			ring.truncated ||
				entry.diagnosticsTruncated ||
				entry.diagnostics.truncated ||
				entry.stderr.truncated,
		);
	}

	getCapturedDiagnostics(
		projectId: string,
		snapshotId: string,
	): DiagnosticsSnapshot {
		return this.snapshots.get(projectId, snapshotId);
	}

	close(): Promise<void> {
		this.closed = true;
		this.closing ??= Promise.allSettled(
			[...this.entries.keys()].map(id => this.stop(id)),
		).then(results => {
			const errors = results.filter(result => result.status === 'rejected');
			if (errors.length)
				throw new AggregateError(
					errors.map(result => result.reason),
					'Project processes did not close cleanly',
				);
		});
		return this.closing;
	}
}
