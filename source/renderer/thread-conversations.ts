import {
	createStreamBatcher,
	type StreamBatchClock,
} from '@/renderer/stream-batcher';
import {
	appendFailure,
	applyEvents,
	carryFailureRows,
	carryMessageRows,
	carryMessageTimes,
	type EvictedThreadMemory,
	emptyTranscript,
	extractEvictedThread,
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
	now?: () => number;
	// Idle views beyond this count are dropped, least recently written first.
	maxViews?: number;
}) {
	const now = options.now ?? Date.now;
	const maxViews = options.maxViews ?? 16;
	type View = Omit<ThreadConversationState, 'projectId' | 'activeThreadId'>;
	const empty: View = {
		transcript: emptyTranscript,
		draft: '',
		turn: null,
		cancellation: null,
	};
	const views = new Map<string, View>();
	// Bounded LRU memory of compact failure anchors and live session timestamps
	// kept when an idle view is evicted, without retaining unrelated prompt text.
	const maxRemembered = 64;
	const remembered = new Map<string, EvictedThreadMemory>();
	const removed = new Set<string>();
	const replaying = new Set<string>();
	// Threads with a turn that sent live events and has no result yet.
	const streaming = new Set<string>();
	const tickets = new Map<string, TurnTicket>();
	let projectId: string | null = null;
	let activeThreadId: string | null = null;
	let disposed = false;
	let generation = 0;
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
	const remember = (viewKey: string, transcript: Transcript) => {
		const compact = extractEvictedThread(transcript);
		if (!compact) return;
		remembered.delete(viewKey);
		remembered.set(viewKey, compact);
		while (remembered.size > maxRemembered) {
			const oldest = remembered.keys().next().value;
			if (oldest === undefined) break;
			remembered.delete(oldest);
		}
	};
	// Idle views go first. Live turns, approvals, drafts and the view just
	// written stay; an idle thread reloads from its snapshot when opened again.
	const trim = (keep?: string) => {
		const active = activeThreadId ? key(activeThreadId) : null;
		for (const [viewKey, held] of views) {
			if (views.size <= maxViews) return;
			if (
				viewKey === active ||
				viewKey === keep ||
				tickets.has(viewKey) ||
				replaying.has(viewKey) ||
				streaming.has(viewKey) ||
				held.draft !== '' ||
				held.transcript.permissions.length > 0
			)
				continue;
			remember(viewKey, held.transcript);
			views.delete(viewKey);
		}
	};
	const put = (threadId: string, patch: Partial<View>) => {
		const viewKey = key(threadId);
		const next = {...view(threadId), ...patch};
		// Deleting first moves the view to the newest end of the map.
		views.delete(viewKey);
		views.set(viewKey, next);
		trim(viewKey);
		emit();
	};
	const terminal = (
		transcript: Transcript,
		result: IpcResult<TurnResult>,
	): Pick<View, 'turn' | 'transcript'> => {
		const settled = settleSubagentTurn(
			transcript,
			result.ok
				? result.value.stopReason === 'cancelled'
					? 'cancelled'
					: 'completed'
				: 'failed',
		);
		const last = settled.items.at(-1);
		return {
			turn: result,
			transcript:
				!result.ok &&
				!(last?.kind === 'failure' && last.text === result.error.message)
					? appendFailure(settled, result.error.message)
					: settled,
		};
	};
	const batcher = createStreamBatcher((threadId, events, tag) => {
		if (allowed(threadId))
			put(threadId, {
				transcript: applyEvents(
					view(threadId).transcript,
					events,
					tag === 'live' ? now() : undefined,
				),
				...(events.some(event => event.type === 'user') && {turn: null}),
			});
	}, options.clock);
	return {
		getState: state,
		selectProject(selected: string | null) {
			if (disposed || selected === projectId) return;
			batcher.flush();
			tickets.clear();
			replaying.clear();
			streaming.clear();
			generation++;
			projectId = selected;
			activeThreadId = null;
			trim();
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
			trim();
			emit();
		},
		setDraft(draft: string) {
			if (activeThreadId && allowed(activeThreadId))
				put(activeThreadId, {draft});
		},
		receive(event: Extract<ProjectEvent, {type: 'turn'}>) {
			if (event.projectId !== projectId || !allowed(event.threadId)) return;
			const current = generation;
			if (event.replay) {
				batcher.flush(event.threadId);
				if (event.replay.phase === 'begin') replaying.add(key(event.threadId));
				else replaying.delete(key(event.threadId));
			}
			if (event.result) streaming.delete(key(event.threadId));
			else if (event.events.length && !replaying.has(key(event.threadId)))
				streaming.add(key(event.threadId));
			batcher.enqueue(
				event.threadId,
				event.events,
				replaying.has(key(event.threadId)) ? 'replay' : 'live',
			);
			if (
				event.events.some(
					item =>
						item.type === 'permission' || item.type === 'permission-closed',
				)
			) {
				batcher.flush(event.threadId);
			}
			if (event.result) {
				batcher.flush(event.threadId);
				if (
					current === generation &&
					event.projectId === projectId &&
					allowed(event.threadId)
				)
					put(
						event.threadId,
						terminal(view(event.threadId).transcript, event.result),
					);
			}
		},
		snapshot(snapshot: ThreadSnapshot) {
			const threadId = snapshot.thread.id;
			if (snapshot.thread.projectId !== projectId || !allowed(threadId))
				return false;
			const current = generation;
			batcher.flush(threadId);
			if (
				current !== generation ||
				snapshot.thread.projectId !== projectId ||
				!allowed(threadId)
			)
				return false;
			// The stream folds a replay begin marker into this snapshot.
			if (snapshot.replaying) replaying.add(key(threadId));
			else replaying.delete(key(threadId));
			const viewKey = key(threadId);
			const previous = view(threadId).transcript;
			const saved = remembered.get(viewKey);
			remembered.delete(viewKey);
			// Failure rows are not in the history, so messages match without them.
			const history = {
				...previous,
				items: previous.items.filter(item => item.kind !== 'failure'),
			};
			const transcript = carryFailureRows(
				previous,
				carryMessageTimes(
					history,
					carryMessageRows(
						history,
						applyEvents(emptyTranscript, snapshot.events),
					),
					saved?.times,
				),
				saved?.failures,
			);
			if (snapshot.result) streaming.delete(key(threadId));
			put(
				threadId,
				snapshot.result
					? terminal(transcript, snapshot.result)
					: {transcript, turn: null},
			);
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
			if (result !== null) streaming.delete(key(ticket.threadId));
			const current = view(ticket.threadId);
			if (current.turn) return result !== null;
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
						? appendFailure(transcript, result.error.message, displayed)
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
			remembered.delete(key(threadId));
			tickets.delete(key(threadId));
			replaying.delete(key(threadId));
			streaming.delete(key(threadId));
			removed.add(key(threadId));
			if (activeThreadId === threadId) activeThreadId = null;
			emit();
		},
		dispose() {
			disposed = true;
			batcher.dispose();
			tickets.clear();
			views.clear();
			remembered.clear();
			removed.clear();
			replaying.clear();
			streaming.clear();
			projectId = null;
			activeThreadId = null;
		},
	};
}
