import type {StreamBatchClock} from '@/renderer/stream-batcher';
import {
	createThreadController,
	type ThreadControllerState,
} from '@/renderer/thread-controller';
import {
	createThreadConversations,
	type ThreadConversationState,
} from '@/renderer/thread-conversations';
import {emptyTranscript} from '@/renderer/transcript';
import type {DesktopApi} from '@/shared/desktop-api';
import type {IpcResult} from '@/shared/ipc';

export interface ThreadWorkspaceState {
	workspace: ThreadControllerState;
	conversation: ThreadConversationState;
}

const emptyWorkspace = (projectId: string | null): ThreadControllerState => ({
	projectId,
	threads: [],
	activeThreadId: null,
	loading: projectId !== null,
	pending: false,
	promptingThreadId: null,
	cancellingThreadIds: [],
	error: null,
});
const emptyConversation = (
	projectId: string | null,
	activeThreadId: string | null = null,
): ThreadConversationState => ({
	projectId,
	activeThreadId,
	transcript: emptyTranscript,
	draft: '',
	turn: null,
	cancellation: null,
});

export function threadWorkspaceForProject(
	state: ThreadWorkspaceState | null,
	projectId: string | null,
): ThreadWorkspaceState {
	return state?.workspace.projectId === projectId
		? state
		: {
				workspace: emptyWorkspace(projectId),
				conversation: emptyConversation(projectId),
			};
}

export function createThreadWorkspace(options: {
	bridge: Parameters<typeof createThreadController>[0]['bridge'] &
		Pick<DesktopApi, 'getUiState'>;
	onChange(state: ThreadWorkspaceState): void;
	clock?: StreamBatchClock;
}) {
	let workspace = emptyWorkspace(null);
	let selection = 0;
	let disposed = false;
	const getState = (): ThreadWorkspaceState => {
		const current = conversations.getState();
		return {
			workspace,
			conversation:
				current.projectId === workspace.projectId &&
				current.activeThreadId === workspace.activeThreadId
					? current
					: emptyConversation(workspace.projectId, workspace.activeThreadId),
		};
	};
	const emit = () => {
		if (!disposed) options.onChange(getState());
	};
	const conversations = createThreadConversations({
		onChange: emit,
		clock: options.clock,
	});
	const controller = createThreadController({
		bridge: options.bridge,
		onChange(next) {
			const previous = workspace;
			workspace = next;
			conversations.selectProject(next.projectId);
			for (const thread of next.threads) {
				const before = previous.threads.find(row => row.id === thread.id);
				if (
					before &&
					before.runState !== thread.runState &&
					thread.runState !== 'running'
				)
					conversations.flush(thread.id);
			}
			if (
				previous.promptingThreadId &&
				previous.promptingThreadId !== next.promptingThreadId
			)
				conversations.flush(previous.promptingThreadId);
			conversations.selectThread(next.activeThreadId);
			emit();
		},
		onSnapshot: snapshot => {
			conversations.snapshot(snapshot);
		},
		onTurn: event => conversations.receive(event),
		onRemoved: threadId => conversations.remove(threadId),
	});
	workspace = controller.getState();
	const create = async () => {
		conversations.flush();
		if (!(await controller.create())) return false;
		const id = workspace.activeThreadId;
		return id ? controller.read(id) : false;
	};
	return {
		getState,
		selectProject: async (projectId: string | null) => {
			if (disposed) return;
			const current = ++selection;
			const selecting = controller.selectProject(projectId);
			if (!projectId) return selecting;
			const [, ui] = await Promise.all([
				selecting,
				options.bridge.getUiState({}).catch(() => null),
			]);
			if (
				disposed ||
				current !== selection ||
				workspace.projectId !== projectId
			)
				return;
			const rows = workspace.threads;
			const preferred =
				ui?.ok && ui.value.activeProjectId === projectId
					? rows.find(row => row.id === ui.value.activeThreadId)
					: undefined;
			const ordered = [...rows].sort((a, b) =>
				a.archiveState !== b.archiveState
					? a.archiveState === 'active'
						? -1
						: 1
					: b.lastActivityAt.localeCompare(a.lastActivityAt),
			);
			const id = workspace.activeThreadId ?? preferred?.id ?? ordered[0]?.id;
			if (id) await controller.read(id);
		},
		ensureThread: async () => {
			if (
				disposed ||
				!workspace.projectId ||
				workspace.loading ||
				workspace.pending ||
				workspace.error ||
				workspace.threads.length
			)
				return false;
			return create();
		},
		create,
		open: (threadId: string) => {
			conversations.flush();
			return controller.open(threadId);
		},
		reload: (projectId: string) => {
			conversations.flush();
			return workspace.projectId === projectId && workspace.activeThreadId
				? controller.read(workspace.activeThreadId)
				: Promise.resolve(false);
		},
		setDraft: conversations.setDraft,
		send: async () => {
			const threadId = workspace.activeThreadId;
			if (
				!threadId ||
				workspace.pending ||
				workspace.loading ||
				workspace.promptingThreadId
			)
				return null;
			const ticket = conversations.beginTurn(threadId);
			if (!ticket) return null;
			const result = await controller.prompt(threadId, ticket.text);
			conversations.finishTurn(ticket, result);
			return result;
		},
		cancel: async (threadId: string) => {
			const projectId = workspace.projectId;
			conversations.flush(threadId);
			const result = await controller.cancel(threadId);
			if (result && projectId)
				conversations.setCancellation(projectId, threadId, result);
			return result;
		},
		answer: async (
			threadId: string,
			requestId: string,
			optionId: string,
		): Promise<IpcResult<null>> => {
			conversations.flush(threadId);
			const result = await controller.answer(threadId, requestId, optionId);
			conversations.flush(threadId);
			return (
				result ?? {
					ok: false,
					error: {
						code: 'DENIED',
						message: 'this approval is no longer current',
						retryable: false,
					},
				}
			);
		},
		rename: controller.rename,
		archive: controller.archive,
		remove: controller.remove,
		deleteHistory: controller.deleteHistory,
		dispose() {
			disposed = true;
			selection++;
			controller.dispose();
			conversations.dispose();
		},
	};
}
