import {
	createStreamBatcher,
	type StreamBatchClock,
} from '@/renderer/stream-batcher';
import {
	applyEvents,
	emptyTranscript,
	settleSubagentTurn,
	type Transcript,
} from '@/renderer/transcript';
import type {
	IpcResult,
	ProjectEvent,
	ThreadSnapshot,
	TurnResult,
} from '@/shared/ipc';

export interface ThreadConversationState {
	projectId: string | null;
	activeThreadId: string | null;
	transcript: Transcript;
	draft: string;
	turn: IpcResult<TurnResult> | null;
	cancellation: IpcResult<null> | null;
}

interface TurnTicket {
	projectId: string;
	threadId: string;
	text: string;
	draft: string;
	userCount: number;
}

export function createThreadConversations(options: {
	onChange(state: ThreadConversationState): void;
	clock?: StreamBatchClock;
}) {
	type View = Omit<ThreadConversationState, 'projectId' | 'activeThreadId'>;
	const empty: View = {
		transcript: emptyTranscript,
		draft: '',
		turn: null,
		cancellation: null,
	};
	const views = new Map<string, View>();
	const removed = new Set<string>();
	const tickets = new Map<string, TurnTicket>();
	let projectId: string | null = null;
	let activeThreadId: string | null = null;
	let disposed = false;
	const key = (threadId: string) => JSON.stringify([projectId, threadId]);
	const view = (threadId: string | null) =>
		threadId ? (views.get(key(threadId)) ?? empty) : empty;
	const state = (): ThreadConversationState => ({
		projectId,
		activeThreadId,
		...view(activeThreadId),
	});
	const emit = () => {
		if (!disposed) options.onChange(state());
	};
	const allowed = (threadId: string) =>
		!disposed && projectId !== null && !removed.has(key(threadId));
	const put = (threadId: string, patch: Partial<View>) => {
		views.set(key(threadId), {...view(threadId), ...patch});
		emit();
	};
	const batcher = createStreamBatcher((threadId, events) => {
		if (allowed(threadId))
			put(threadId, {
				transcript: applyEvents(view(threadId).transcript, events),
			});
	}, options.clock);
	return {
		getState: state,
		selectProject(selected: string | null) {
			if (disposed || selected === projectId) return;
			batcher.flush();
			tickets.clear();
			projectId = selected;
			activeThreadId = null;
			emit();
		},
		selectThread(threadId: string | null) {
			if (
				disposed ||
				!projectId ||
				threadId === activeThreadId ||
				(threadId && !allowed(threadId))
			)
				return;
			batcher.flush();
			activeThreadId = threadId;
			emit();
		},
		setDraft(draft: string) {
			if (activeThreadId && allowed(activeThreadId))
				put(activeThreadId, {draft});
		},
		receive(event: Extract<ProjectEvent, {type: 'turn'}>) {
			if (event.projectId !== projectId || !allowed(event.threadId)) return;
			batcher.enqueue(event.threadId, event.events);
			if (
				event.events.some(
					item =>
						item.type === 'permission' || item.type === 'permission-closed',
				)
			)
				batcher.flush(event.threadId);
		},
		snapshot(snapshot: ThreadSnapshot) {
			const threadId = snapshot.thread.id;
			if (snapshot.thread.projectId !== projectId || !allowed(threadId))
				return false;
			batcher.flush(threadId);
			const previous = view(threadId).transcript;
			const transcript = applyEvents(emptyTranscript, snapshot.events);
			put(threadId, {
				transcript: {
					...transcript,
					items: [
						...transcript.items,
						...previous.items.filter(item => item.kind === 'failure'),
					],
				},
			});
			return true;
		},
		beginTurn(threadId: string): TurnTicket | null {
			const current = view(threadId);
			if (
				!allowed(threadId) ||
				!projectId ||
				activeThreadId !== threadId ||
				tickets.size ||
				!current.draft.trim()
			)
				return null;
			batcher.flush(threadId);
			const ticket = {
				projectId,
				threadId,
				text: current.draft.trim(),
				draft: current.draft,
				userCount: view(threadId).transcript.items.filter(
					item => item.kind === 'user',
				).length,
			};
			tickets.set(key(threadId), ticket);
			put(threadId, {draft: '', turn: null, cancellation: null});
			return ticket;
		},
		finishTurn(ticket: TurnTicket, result: IpcResult<TurnResult> | null) {
			const isCurrent = () =>
				ticket.projectId === projectId &&
				allowed(ticket.threadId) &&
				tickets.get(key(ticket.threadId)) === ticket;
			if (!isCurrent()) return false;
			batcher.flush(ticket.threadId);
			if (!isCurrent()) return false;
			tickets.delete(key(ticket.threadId));
			const current = view(ticket.threadId);
			const interrupted =
				!result || !result.ok || result.value.stopReason === 'cancelled';
			const displayed = current.transcript.items
				.flatMap(item => (item.kind === 'user' ? [item.text] : []))
				.slice(ticket.userCount)
				.includes(ticket.text);
			const transcript =
				result && displayed
					? settleSubagentTurn(
							current.transcript,
							result.ok
								? result.value.stopReason === 'cancelled'
									? 'cancelled'
									: 'completed'
								: 'failed',
						)
					: current.transcript;
			put(ticket.threadId, {
				draft:
					interrupted && !displayed && !current.draft
						? ticket.draft
						: current.draft,
				turn: result,
				transcript:
					result && !result.ok
						? {
								...transcript,
								items: [
									...transcript.items,
									{kind: 'failure', text: result.error.message},
								],
							}
						: transcript,
			});
			return result !== null;
		},
		setCancellation(owner: string, threadId: string, result: IpcResult<null>) {
			if (owner !== projectId || !allowed(threadId)) return false;
			batcher.flush(threadId);
			put(threadId, {cancellation: result});
			return true;
		},
		flush(threadId?: string) {
			if (!disposed) batcher.flush(threadId);
		},
		remove(threadId: string) {
			if (!allowed(threadId)) return;
			batcher.remove(threadId);
			views.delete(key(threadId));
			tickets.delete(key(threadId));
			removed.add(key(threadId));
			if (activeThreadId === threadId) activeThreadId = null;
			emit();
		},
		dispose() {
			disposed = true;
			batcher.dispose();
			tickets.clear();
			views.clear();
			removed.clear();
			projectId = null;
			activeThreadId = null;
		},
	};
}
