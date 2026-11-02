import type {ThreadInfo} from '@/shared/ipc';

export function threadComposerState({
	thread,
	accepting,
	replay,
	pending,
}: {
	thread: ThreadInfo | null;
	accepting: boolean;
	replay: 'replaying' | 'failed' | undefined;
	pending: boolean;
}) {
	return {
		visible: thread !== null && thread.runState !== 'view-only',
		editable:
			(accepting || replay !== undefined) &&
			thread?.archiveState === 'active' &&
			thread.runState !== 'view-only' &&
			(replay !== undefined || !pending),
	};
}
