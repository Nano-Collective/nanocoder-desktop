import {
	type NanocoderConnection,
	NanocoderFailure,
	type ResumedSession,
} from '@/main/nanocoder/acp-client';
import {type SupervisorClock, systemClock} from '@/main/nanocoder/clock';
import type {
	ProjectActivity,
	ProjectSupervisor,
} from '@/main/nanocoder/supervisor';
import type {ProjectInfo, SessionInfo} from '@/shared/ipc';

export class TechnicalSessions {
	private readonly sessions = new Map<
		string,
		{connection: NanocoderConnection; session: SessionInfo; sessionCwd: string}
	>();
	private readonly preparing = new Map<string, Promise<SessionInfo>>();
	private readonly attached = new Set<string>();
	private readonly restoring = new Set<string>();
	private readonly lastActivity = new Map<string, number>();

	constructor(
		private readonly supervisor: ProjectSupervisor,
		private readonly clock: SupervisorClock = systemClock,
	) {}

	activity(projectId: string): ProjectActivity {
		return {
			runningTurn: this.supervisor.getState(projectId).activeThreadId !== null,
			openSessions: this.attached.has(projectId) ? 1 : 0,
			preparing: this.preparing.has(projectId) || this.restoring.has(projectId),
			lastActivityAt: this.lastActivity.get(projectId) ?? 0,
		};
	}

	async restore(
		project: ProjectInfo,
		connection: NanocoderConnection,
		signal: AbortSignal,
	): Promise<ResumedSession | undefined> {
		signal.throwIfAborted();
		const cached = this.sessions.get(project.id);
		if (!cached || !this.attached.has(project.id)) return;
		if (
			cached.sessionCwd !== project.sessionCwd ||
			cached.connection.agent.root !== project.canonicalRoot ||
			connection.agent.root !== project.canonicalRoot ||
			project.sessionCwd !== project.canonicalRoot
		) {
			this.sessions.delete(project.id);
			throw new NanocoderFailure(
				'AGENT_UNAVAILABLE',
				'The project folder changed; open it again before resuming',
			);
		}
		this.restoring.add(project.id);
		try {
			const restored = await connection.resumeSession(
				cached.session.id,
				project.defaultMode,
			);
			signal.throwIfAborted();
			this.sessions.set(project.id, {
				connection,
				session: restored.session,
				sessionCwd: project.sessionCwd,
			});
			return restored;
		} finally {
			this.restoring.delete(project.id);
		}
	}

	prepare(project: ProjectInfo, signal?: AbortSignal): Promise<SessionInfo> {
		signal?.throwIfAborted();
		const pending = this.preparing.get(project.id);
		if (pending) return pending;
		const connection = this.supervisor.getConnection(project.id);
		this.attached.add(project.id);
		this.lastActivity.set(project.id, this.clock.now());
		let cached = this.sessions.get(project.id);
		if (cached && cached.sessionCwd !== project.sessionCwd) {
			this.sessions.delete(project.id);
			cached = undefined;
		}
		if (cached?.connection === connection)
			return Promise.resolve(cached.session);
		const preparation = Promise.resolve()
			.then(async () => {
				signal?.throwIfAborted();
				const session = cached
					? (
							await connection.resumeSession(
								cached.session.id,
								project.defaultMode,
							)
						).session
					: await connection.newSession(project.defaultMode);
				signal?.throwIfAborted();
				if (this.supervisor.getConnection(project.id) !== connection)
					throw new NanocoderFailure(
						'AGENT_UNAVAILABLE',
						'The project process changed during session preparation',
					);
				this.sessions.set(project.id, {
					connection,
					session,
					sessionCwd: project.sessionCwd,
				});
				return session;
			})
			.catch(async error => {
				this.sessions.delete(project.id);
				this.attached.delete(project.id);
				await this.supervisor.stop(project.id);
				throw error;
			})
			.finally(() => {
				this.preparing.delete(project.id);
			});
		this.preparing.set(project.id, preparation);
		return preparation;
	}

	// Until ThreadService snapshots exist, detached work is cancelled, never allowed.
	async detach(projects: Iterable<ProjectInfo>): Promise<void> {
		const preparations = [...this.preparing.values()];
		const ids = new Set(this.preparing.keys());
		for (const project of projects) {
			this.attached.delete(project.id);
			this.lastActivity.set(project.id, this.clock.now());
			const state = this.supervisor.getState(project.id);
			if (
				state.activeThreadId ||
				state.status === 'starting' ||
				state.restart.nextAttemptAt
			)
				ids.add(project.id);
		}
		await Promise.allSettled([
			...[...ids].map(id => this.supervisor.stop(id)),
			...preparations,
		]);
	}
}
