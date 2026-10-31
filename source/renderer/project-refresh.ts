import type {DesktopApi} from '@/shared/desktop-api';
import type {ProjectInfo} from '@/shared/ipc';
import {perf03Experiment} from './perf03-experiment';

interface RefreshTarget {
	current(): boolean;
	projects(value: ProjectInfo[], experimentReadId: number): void;
	activeProject(value: string | null): void;
	failed(message: string): void;
}

export async function readRecentProjects(
	desktop: Pick<DesktopApi, 'listProjects' | 'getUiState'>,
	target: RefreshTarget,
): Promise<void> {
	const readId = perf03Experiment.readStart();
	try {
		const [result, ui] = await Promise.all([
			desktop.listProjects({}),
			desktop.getUiState({}),
		]);
		const current = target.current();
		perf03Experiment.mark('recents-read-resolved', performance.now(), {
			readId,
			current,
		});
		if (!current) return;
		if (ui.ok) target.activeProject(ui.value.activeProjectId);
		if (result.ok) target.projects(result.value, readId);
		else target.failed(result.error.message);
	} catch {
		if (target.current()) target.failed('recent projects are unavailable');
	}
}

export function subscribeProjectRefresh(
	desktop: Pick<DesktopApi, 'onProjectEvent'>,
	refresh: () => Promise<void>,
): () => void {
	const sequences = new Map<string, number>();
	let disposed = false;
	const unsubscribe = desktop.onProjectEvent(event => {
		if (disposed || event.type === 'turn') return;
		if (event.sequence <= (sequences.get(event.projectId) ?? 0)) return;
		sequences.set(event.projectId, event.sequence);
		if (
			event.type === 'projects-changed' ||
			event.type === 'project' ||
			event.type === 'project-removed' ||
			(event.type === 'supervisor' && event.state.status === 'untrusted')
		) {
			if (perf03Experiment.suppress(event.type)) return;
			void refresh();
		}
	});
	return () => {
		disposed = true;
		unsubscribe();
		sequences.clear();
	};
}
