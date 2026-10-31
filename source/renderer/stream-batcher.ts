import type {TurnEvent} from '@/shared/ipc';

export interface StreamBatchClock {
	schedule(callback: () => void, delayMs: number): () => void;
}

export function createStreamBatcher(
	deliver: (
		threadId: string,
		events: readonly TurnEvent[],
		tag?: string,
	) => void,
	clock: StreamBatchClock = {
		schedule(callback, delayMs) {
			const timer = globalThis.setTimeout(callback, delayMs);
			return () => globalThis.clearTimeout(timer);
		},
	},
) {
	let queue: {threadId: string; events: TurnEvent[]; tag?: string}[] = [];
	let cancel: (() => void) | undefined;
	let generation = 0;
	let disposed = false;
	const clearTimer = () => {
		cancel?.();
		cancel = undefined;
		generation++;
	};
	function flush(threadId?: string) {
		const ready =
			threadId === undefined
				? queue
				: queue.filter(batch => batch.threadId === threadId);
		queue =
			threadId === undefined
				? []
				: queue.filter(batch => batch.threadId !== threadId);
		if (!queue.length) clearTimer();
		for (const batch of ready) deliver(batch.threadId, batch.events, batch.tag);
	}
	return {
		enqueue(threadId: string, events: readonly TurnEvent[], tag?: string) {
			if (disposed || !events.length) return;
			const last = queue.at(-1);
			if (last?.threadId === threadId && last.tag === tag)
				last.events.push(...events);
			else queue.push({threadId, events: [...events], tag});
			if (cancel) return;
			const token = ++generation;
			cancel = clock.schedule(() => {
				if (disposed || token !== generation) return;
				cancel = undefined;
				flush();
			}, 16);
		},
		flush,
		remove(threadId: string) {
			queue = queue.filter(batch => batch.threadId !== threadId);
			if (!queue.length) clearTimer();
		},
		dispose() {
			disposed = true;
			queue = [];
			clearTimer();
		},
	};
}
