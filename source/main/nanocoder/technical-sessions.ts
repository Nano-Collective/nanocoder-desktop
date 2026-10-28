import type {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import type {ProjectInfo, SessionInfo} from '@/shared/ipc';

export async function prepareSession(
	supervisor: ProjectSupervisor,
	project: ProjectInfo,
	sessions: Map<string, SessionInfo>,
	wasReady: boolean,
): Promise<SessionInfo> {
	const connection = supervisor.getConnection(project.id);
	const cached = sessions.get(project.id);
	try {
		const prepared = !cached
			? await connection.newSession(project.defaultMode)
			: wasReady
				? cached
				: (await connection.resumeSession(cached.id, project.defaultMode))
						.session;
		sessions.set(project.id, prepared);
		return prepared;
	} catch (error) {
		sessions.delete(project.id);
		await supervisor.stop(project.id);
		throw error;
	}
}

// The technical gate has no ThreadService snapshot to re-fetch after a reload.
export async function stopDetachedTurns(
	supervisor: ProjectSupervisor,
	projects: Iterable<ProjectInfo>,
): Promise<void> {
	const stops = [];
	for (const project of projects) {
		const state = supervisor.getState(project.id);
		if (state.activeThreadId || state.status === 'starting')
			stops.push(supervisor.stop(project.id));
	}
	const results = await Promise.allSettled(stops);
	const failures = results.filter(result => result.status === 'rejected');
	if (failures.length)
		throw new AggregateError(
			failures.map(result => result.reason),
			'Detached turns did not stop cleanly',
		);
}
