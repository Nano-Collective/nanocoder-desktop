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
	if (event.type !== 'supervisor' && event.type !== 'project-removed')
		return current;
	if (event.type === 'supervisor' && event.state.projectId !== event.projectId)
		return current;
	const previous = current[event.projectId];
	if (previous && previous.sequence >= event.sequence) return current;
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
		entry => entry.root === root,
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
