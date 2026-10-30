import type {ProjectEvent, ThreadSnapshot} from '@/shared/ipc';

type ThreadTurn = Extract<ProjectEvent, {type: 'turn'}>;

export function createThreadStream(options: {
	onSnapshot(snapshot: ThreadSnapshot): void;
	onTurn(event: ThreadTurn): void;
	onGap(threadId: string, token: number): void;
}) {
	let token = 0;
	let projectId: string | null = null;
	const sequences = new Map<string, number>();
	const pending = new Map<
		string,
		{token: number; events: ThreadTurn[]; requested: boolean}
	>();
	const begin = (threadId: string) => {
		const value = ++token;
		pending.set(threadId, {
			token: value,
			events: pending.get(threadId)?.events ?? [],
			requested: true,
		});
		return value;
	};
	const deliver = (event: ThreadTurn) => {
		sequences.set(event.threadId, event.sequence);
		options.onTurn(structuredClone(event));
	};
	const receive = (event: ThreadTurn) => {
		if (
			event.projectId !== projectId ||
			!Number.isSafeInteger(event.sequence) ||
			event.sequence < 1 ||
			event.sequence <= (sequences.get(event.threadId) ?? -1)
		)
			return;
		const waiting = pending.get(event.threadId);
		if (waiting) {
			waiting.events.push(structuredClone(event));
			if (!waiting.requested) {
				waiting.requested = true;
				options.onGap(event.threadId, waiting.token);
			}
		} else if (event.sequence === (sequences.get(event.threadId) ?? -1) + 1) {
			deliver(event);
		} else {
			const value = begin(event.threadId);
			pending.get(event.threadId)?.events.push(structuredClone(event));
			options.onGap(event.threadId, value);
		}
	};
	return {
		selectProject: (selected: string | null) => {
			projectId = selected;
			sequences.clear();
			pending.clear();
		},
		begin,
		replace: (value: number, snapshot: ThreadSnapshot) => {
			const threadId = snapshot.thread.id;
			const waiting = pending.get(threadId);
			if (
				snapshot.thread.projectId !== projectId ||
				waiting?.token !== value ||
				!Number.isSafeInteger(snapshot.sequence) ||
				snapshot.sequence < 0
			)
				return false;
			if (snapshot.sequence < (sequences.get(threadId) ?? -1)) {
				waiting.requested = false;
				return false;
			}
			pending.delete(threadId);
			sequences.set(threadId, snapshot.sequence);
			options.onSnapshot(structuredClone(snapshot));
			for (const [index, event] of waiting.events.entries()) {
				const previous = sequences.get(threadId) ?? -1;
				if (event.sequence <= previous) continue;
				if (event.sequence !== previous + 1) {
					pending.set(threadId, {
						token: ++token,
						events: waiting.events.slice(index),
						requested: false,
					});
					return false;
				}
				deliver(event);
			}
			return true;
		},
		receive,
		isCurrent: (threadId: string, value: number) =>
			pending.get(threadId)?.token === value,
		remove: (threadId: string) => {
			sequences.delete(threadId);
			pending.delete(threadId);
		},
		needsSnapshot: (threadId: string) =>
			!sequences.has(threadId) || pending.has(threadId),
	};
}
