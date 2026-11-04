import type {
	ProjectActivityStatus,
	ProjectEvent,
	ProjectInfo,
} from '@/shared/ipc';

export type ActivityState = Readonly<
	Record<string, {status: ProjectActivityStatus; sequence: number}>
>;

export const emptyActivity: ActivityState = {};

// What each project needs, from main's events only (CHAT-22). A late or repeated event
// never undoes a newer one.
export function reduceActivity(
	state: ActivityState,
	event: ProjectEvent,
): ActivityState {
	if (event.type === 'project-activity') {
		if (event.sequence <= (state[event.projectId]?.sequence ?? 0)) return state;
		return {
			...state,
			[event.projectId]: {status: event.status, sequence: event.sequence},
		};
	}
	if (event.type === 'project-removed' && event.projectId in state) {
		const {[event.projectId]: _removed, ...rest} = state;
		return rest;
	}
	return state;
}

type Attention = Exclude<ProjectActivityStatus, 'idle'>;

const presentation: Record<
	Attention,
	{glyph: string; label: string; rank: number}
> = {
	'needs-approval': {glyph: '▲', label: 'needs approval', rank: 0},
	running: {glyph: '●', label: 'running', rank: 1},
	failed: {glyph: '✕', label: 'failed', rank: 2},
	finished: {glyph: '✓', label: 'finished', rank: 3},
};

export interface BackgroundItem {
	projectId: string;
	name: string;
	status: Attention;
	glyph: string;
	label: string;
}

// Projects other than the one in view that are working, waiting or just done.
export function backgroundItems(
	state: ActivityState,
	projects: readonly ProjectInfo[],
	activeProjectId: string | null,
): BackgroundItem[] {
	const items: BackgroundItem[] = [];
	for (const project of projects) {
		const status = state[project.id]?.status;
		if (!status || status === 'idle' || project.id === activeProjectId)
			continue;
		items.push({
			projectId: project.id,
			name: project.displayName,
			status,
			glyph: presentation[status].glyph,
			label: presentation[status].label,
		});
	}
	return items.sort(
		(a, b) =>
			presentation[a.status].rank - presentation[b.status].rank ||
			a.name.localeCompare(b.name),
	);
}

// What to say when a background project starts needing the user: approval, or an end.
// Running is visible in the rail and never announced, so a busy day stays quiet.
export function announcementsFor(
	previous: ReadonlyMap<string, string>,
	items: readonly BackgroundItem[],
): string[] {
	return items
		.filter(
			item =>
				item.status !== 'running' &&
				previous.get(item.projectId) !== item.status,
		)
		.map(item => `${item.name} ${item.label}`);
}
