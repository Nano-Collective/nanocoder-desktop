import type {PaletteAction} from '@/renderer/overlay-model';
import {threadMutationReason} from '@/renderer/thread-rail-model';
import type {ThreadInfo} from '@/shared/ipc';

interface ThreadControls {
	projectId: string | null;
	thread: ThreadInfo | null;
	pending: boolean;
	renameDisabledReason?: string;
	onNew(projectId: string): void;
	onRename(threadId: string): void;
	onArchive(threadId: string, archived: boolean): void;
}

export function threadPalette(controls: ThreadControls): PaletteAction[] {
	const selected =
		controls.thread?.projectId === controls.projectId ? controls.thread : null;
	const busy = controls.pending
		? 'another thread request is pending'
		: undefined;
	const reason = threadMutationReason(selected, controls.pending);
	const archived = selected?.archiveState !== 'archived';
	return [
		{
			id: 'thread-new',
			label: 'new thread',
			glyph: '＋',
			keywords: 'new chat session',
			disabledReason:
				busy ?? (controls.projectId ? undefined : 'select a project first'),
			run: () => {
				if (controls.projectId) controls.onNew(controls.projectId);
			},
		},
		{
			id: 'thread-rename',
			label: 'rename thread',
			glyph: '▸',
			keywords: `name chat session ${selected?.title ?? ''}`,
			description: selected?.title,
			disabledReason: reason ?? controls.renameDisabledReason,
			run: () => {
				if (selected) controls.onRename(selected.id);
			},
		},
		{
			id: 'thread-archive',
			label: archived ? 'archive thread' : 'unarchive thread',
			glyph: '░',
			keywords: `history chat session ${selected?.title ?? ''}`,
			description: selected?.title,
			disabledReason: reason,
			run: () => {
				if (selected) controls.onArchive(selected.id, archived);
			},
		},
	];
}
