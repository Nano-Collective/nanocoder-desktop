import {stat} from 'node:fs/promises';
import {IpcFailure} from '@/main/ipc/handle-request';
import {canonicalPath} from '@/main/paths';
import type {ProjectInfo} from '@/shared/ipc';

// Files and Git run only for a stored, trusted, available project whose folder
// is still the one that was trusted (SEC-03, SEC-17). Returns the canonical root.
export async function authorisedRoot(
	project: ProjectInfo | undefined,
): Promise<string> {
	if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
	if (!project.trusted || project.availability !== 'available')
		throw new IpcFailure(
			'DENIED',
			'Trust and open the project before browsing its files',
		);
	const changed = () =>
		new IpcFailure('DENIED', 'The project folder changed; open it again');
	try {
		const root = await canonicalPath(project.canonicalRoot);
		if (
			root !== project.canonicalRoot ||
			root !== project.sessionCwd ||
			!(await stat(root)).isDirectory()
		)
			throw changed();
		return root;
	} catch (error) {
		throw error instanceof IpcFailure ? error : changed();
	}
}
