import type {ProjectEvent, ThreadSnapshot} from '@/shared/ipc';
import {
	threadReplaySchema,
	threadReplaySnapshotSchema,
} from '@/shared/thread-replay';

type ThreadTurn = Extract<ProjectEvent, {type: 'turn'}>;

export function createThreadStream(options: {
	onSnapshot(snapshot: ThreadSnapshot): void;
	onTurn(event: ThreadTurn): void;
	onGap(threadId: string, token: number): void;
	onReplay?(threadId: string, phase: 'begin' | 'complete' | 'failed'): void;
}) {
	let token = 0;
	let generation = 0;
	let projectId: string | null = null;
	const sequences = new Map<string, number>();
	const replays = new Map<
		string,
		{
			epoch?: string;
			phase: 'begin' | 'complete' | 'failed';
			sequence: number;
			completeSequence?: number;
			refreshed: boolean;
		}
	>();
	const retired = new Map<string, Set<string>>();
	const replay = (
		threadId: string,
		epoch: string | undefined,
		phase: 'begin' | 'complete' | 'failed',
		sequence: number,
	) => {
		const previous = replays.get(threadId);
		if (epoch && retired.get(threadId)?.has(epoch)) return false;
		if (previous?.epoch && previous.epoch !== epoch) {
			const values = retired.get(threadId) ?? new Set<string>();
			values.add(previous.epoch);
			retired.set(threadId, values);
		}
		replays.set(threadId, {
			epoch,
			phase,
			sequence,
			completeSequence:
				previous && previous.epoch === epoch
					? previous.completeSequence
					: undefined,
			refreshed:
				previous && previous.epoch === epoch ? previous.refreshed : false,
		});
		options.onReplay?.(threadId, phase);
		return true;
	};
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
		if (event.replay !== undefined) {
			const parsed = threadReplaySchema.safeParse(event.replay);
			if (!parsed.success || event.events.length || event.result) return;
			const {epoch, phase} = parsed.data;
			const previous = replays.get(event.threadId);
			if (phase === 'begin') {
				if (
					previous?.epoch === epoch ||
					!replay(event.threadId, epoch, phase, event.sequence)
				)
					return;
			} else {
				if (previous?.epoch !== epoch || previous.phase !== 'begin') return;
				if (phase === 'failed') {
					replay(event.threadId, epoch, phase, event.sequence);
				} else {
					previous.completeSequence = event.sequence;
					const waiting = pending.get(event.threadId);
					if (waiting) waiting.events.push(structuredClone(event));
					else {
						const value = begin(event.threadId);
						pending.get(event.threadId)?.events.push(structuredClone(event));
						previous.refreshed = true;
						options.onGap(event.threadId, value);
					}
					return;
				}
			}
		}
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
			generation++;
			projectId = selected;
			sequences.clear();
			pending.clear();
			replays.clear();
			retired.clear();
		},
		begin,
		replace: (value: number, snapshot: ThreadSnapshot) => {
			const current = generation;
			const threadId = snapshot.thread.id;
			const waiting = pending.get(threadId);
			if (
				snapshot.thread.projectId !== projectId ||
				waiting?.token !== value ||
				!Number.isSafeInteger(snapshot.sequence) ||
				snapshot.sequence < 0
			)
				return false;
			if (
				!threadReplaySnapshotSchema.safeParse({
					replaying: snapshot.replaying,
					replayEpoch: snapshot.replayEpoch,
				}).success
			)
				return false;
			const previousReplay = replays.get(threadId);
			if (
				(previousReplay?.epoch && !snapshot.replayEpoch) ||
				(snapshot.replayEpoch &&
					retired.get(threadId)?.has(snapshot.replayEpoch)) ||
				(snapshot.replayEpoch !== previousReplay?.epoch &&
					previousReplay &&
					snapshot.sequence < previousReplay.sequence)
			)
				return false;
			if (
				!snapshot.replaying &&
				previousReplay?.completeSequence !== undefined &&
				snapshot.sequence < previousReplay.completeSequence
			) {
				waiting.requested = false;
				return false;
			}
			if (snapshot.sequence < (sequences.get(threadId) ?? -1)) {
				waiting.requested = false;
				return false;
			}
			pending.delete(threadId);
			sequences.set(threadId, snapshot.sequence);
			const failed =
				snapshot.replayEpoch &&
				(snapshot.thread.runState === 'view-only' ||
					(snapshot.thread.runState === 'failed' &&
						snapshot.thread.viewOnlyReason !== null) ||
					(previousReplay?.epoch === snapshot.replayEpoch &&
						previousReplay.phase === 'failed'));
			if (
				(snapshot.replayEpoch || snapshot.replaying) &&
				!replay(
					threadId,
					snapshot.replayEpoch,
					failed ? 'failed' : 'begin',
					snapshot.sequence,
				)
			)
				return false;
			if (current !== generation || pending.has(threadId)) return false;
			options.onSnapshot(structuredClone(snapshot));
			if (
				current !== generation ||
				projectId !== snapshot.thread.projectId ||
				sequences.get(threadId) !== snapshot.sequence ||
				pending.has(threadId)
			)
				return false;
			if (
				!failed &&
				!snapshot.replaying &&
				snapshot.replayEpoch &&
				replays.get(threadId)?.epoch === snapshot.replayEpoch
			)
				replay(threadId, snapshot.replayEpoch, 'complete', snapshot.sequence);
			for (const [index, event] of waiting.events.entries()) {
				if (current !== generation || !sequences.has(threadId)) return false;
				const previous = sequences.get(threadId) ?? -1;
				if (event.sequence <= previous) continue;
				if (
					event.sequence !== previous + 1 ||
					event.replay?.phase === 'complete'
				) {
					const owner = replays.get(threadId);
					const refresh =
						event.replay?.phase === 'complete' &&
						owner?.epoch === event.replay.epoch &&
						!owner.refreshed;
					pending.set(threadId, {
						token: ++token,
						events: waiting.events.slice(index),
						requested: refresh,
					});
					if (refresh && owner) {
						owner.refreshed = true;
						options.onGap(threadId, token);
					}
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
			replays.delete(threadId);
			retired.delete(threadId);
		},
		needsSnapshot: (threadId: string) =>
			!sequences.has(threadId) || pending.has(threadId),
	};
}
