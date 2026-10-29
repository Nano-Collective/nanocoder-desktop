import type {ProjectEvent, SupervisorState} from '@/shared/ipc';

export type SupervisorIndex = Readonly<
	Record<
		string,
		{sequence: number; root: string | null; state: SupervisorState | null}
	>
>;

export type AcpBadge = {status: 'acp-ready' | 'acp-exited'; exitCode?: number};

export function observeSupervisor(
	current: SupervisorIndex,
	event: ProjectEvent,
): SupervisorIndex {
	if (
		event.type !== 'supervisor' &&
		event.type !== 'project-removed' &&
		event.type !== 'project'
	)
		return current;
	if (event.type === 'supervisor' && event.state.projectId !== event.projectId)
		return current;
	if (event.type === 'project' && event.project.id !== event.projectId)
		return current;
	const previous = current[event.projectId];
	if (previous && previous.sequence >= event.sequence) return current;
	if (event.type === 'project') {
		const root = event.project.canonicalRoot;
		return {
			...current,
			[event.projectId]: {
				sequence: event.sequence,
				root,
				state: previous?.root === root ? previous.state : null,
			},
		};
	}
	const state = event.type === 'supervisor' ? event.state : null;
	return {
		...current,
		[event.projectId]: {
			sequence: event.sequence,
			root: state?.agent?.root ?? previous?.root ?? null,
			state,
		},
	};
}

export function acpBadge(
	current: SupervisorIndex,
	root: string,
): AcpBadge | null {
	if (!root) return null;
	const state = Object.values(current).find(
		entry => entry.root === root && entry.state !== null,
	)?.state;
	if (state?.status === 'ready' && state.agent) return {status: 'acp-ready'};
	if (
		(state?.status === 'failed' || state?.status === 'stopped') &&
		state.exit
	) {
		return {status: 'acp-exited', exitCode: state.exit.code ?? undefined};
	}
	return null;
}
