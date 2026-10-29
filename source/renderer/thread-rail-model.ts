import type {ThreadInfo} from '@/shared/ipc';

interface ThreadGroup {
	id: 'today' | 'earlier' | 'archived';
	threads: ThreadInfo[];
}

export function threadGroups(
	projectId: string | null,
	threads: readonly ThreadInfo[],
	now: Date,
): ThreadGroup[] {
	if (!projectId) return [];
	const sorted = threads
		.filter(thread => thread.projectId === projectId)
		.sort(
			(a, b) =>
				Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) ||
				a.id.localeCompare(b.id),
		);
	const today = (thread: ThreadInfo) =>
		new Date(thread.lastActivityAt).toDateString() === now.toDateString();
	const active = sorted.filter(thread => thread.archiveState === 'active');
	return [
		{id: 'today', threads: active.filter(today)},
		{id: 'earlier', threads: active.filter(thread => !today(thread))},
		{
			id: 'archived',
			threads: sorted.filter(thread => thread.archiveState === 'archived'),
		},
	];
}

const appearances = {
	new: {glyph: '◌', tone: 'muted', label: 'new'},
	ready: {glyph: '○', tone: 'muted', label: 'ready'},
	running: {glyph: '●', tone: 'primary', label: 'running'},
	'waiting-approval': {
		glyph: '◐',
		tone: 'warning',
		label: 'waiting for approval',
	},
	interrupted: {glyph: '▲', tone: 'warning', label: 'interrupted'},
	failed: {glyph: '✕', tone: 'error', label: 'failed'},
	'view-only': {glyph: '◍', tone: 'muted', label: 'view-only'},
} as const;

export function threadAppearance(thread: ThreadInfo): {
	glyph: string;
	tone: 'muted' | 'primary' | 'warning' | 'error';
	label: string;
} {
	return thread.archiveState === 'archived'
		? {glyph: '░', tone: 'muted', label: 'archived'}
		: appearances[thread.runState];
}

export function threadMutationReason(
	thread: ThreadInfo | null,
	pending: boolean,
): string | undefined {
	if (pending) return 'another thread request is pending';
	if (!thread) return 'select a thread in this project';
	if (thread.runState === 'running' || thread.runState === 'waiting-approval')
		return 'wait for this thread to finish';
	return undefined;
}
