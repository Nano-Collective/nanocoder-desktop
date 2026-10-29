import {IpcFailure} from '@/main/ipc/handle-request';
import type {ProjectSupervisor} from '@/main/nanocoder/supervisor';
import type {SessionInfo} from '@/shared/ipc';

export async function cancelTechnicalTurn(
	supervisor: Pick<ProjectSupervisor, 'cancel'> | undefined,
	projectId: string | undefined,
	session: SessionInfo | undefined,
): Promise<null> {
	if (!supervisor || !projectId || !session)
		throw new IpcFailure('AGENT_UNAVAILABLE', 'No project is open');
	await supervisor.cancel(projectId, session.id);
	return null;
}
