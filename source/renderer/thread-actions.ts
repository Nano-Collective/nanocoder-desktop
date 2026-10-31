import {threadMutationReason} from '@/renderer/thread-rail-model';
import type {ThreadInfo} from '@/shared/ipc';

export const projectTurnReason =
	'another project turn owns these actions. stop it or wait before changing thread metadata.';

export function threadActionReason(
	thread: ThreadInfo | null,
	pending: boolean,
	projectBusy: boolean,
): string | undefined {
	return (
		threadMutationReason(thread, pending) ??
		(projectBusy ? projectTurnReason : undefined)
	);
}

export function threadMenuReasons(
	thread: ThreadInfo,
	options: {
		pending: boolean;
		projectBusy: boolean;
		renameDisabledReason?: string;
		deleteHistoryDisabledReason?: string;
	},
) {
	const shared = threadActionReason(
		thread,
		options.pending,
		options.projectBusy,
	);
	const hasSession = thread.nanocoderSessionId !== null;
	return {
		shared,
		rename: shared ?? (hasSession ? options.renameDisabledReason : undefined),
		archive: shared,
		remove: shared,
		deleteHistory:
			shared ??
			(hasSession
				? options.deleteHistoryDisabledReason
				: 'this thread has no Nanocoder history'),
	};
}
