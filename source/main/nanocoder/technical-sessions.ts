import {
	type NanocoderConnection,
	NanocoderFailure,
} from '@/main/nanocoder/acp-client';
import type {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import type {ProjectInfo, SessionInfo} from '@/shared/ipc';

export class TechnicalSessions {
	private readonly sessions = new Map<
		string,
		{connection: NanocoderConnection; session: SessionInfo}
	>();
	private readonly preparing = new Map<string, Promise<SessionInfo>>();

	constructor(private readonly supervisor: ProjectSupervisor) {}

	prepare(project: ProjectInfo, signal?: AbortSignal): Promise<SessionInfo> {
		signal?.throwIfAborted();
		const pending = this.preparing.get(project.id);
		if (pending) return pending;
		const connection = this.supervisor.getConnection(project.id);
		const cached = this.sessions.get(project.id);
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
				this.sessions.set(project.id, {connection, session});
				return session;
			})
			.catch(async error => {
				this.sessions.delete(project.id);
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
			const state = this.supervisor.getState(project.id);
			if (state.activeThreadId || state.status === 'starting')
				ids.add(project.id);
		}
		await Promise.allSettled([
			...[...ids].map(id => this.supervisor.stop(id)),
			...preparations,
		]);
	}
}
