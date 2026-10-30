import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {validate} from '@/main/store/validation';

export const MAX_THREAD_BATCH_EVENTS = 10000;
export const MAX_THREAD_REPLAY_EVENTS = 100000;
export const THREAD_SEQUENCE_WIDTH = MAX_THREAD_BATCH_EVENTS + 1;

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export function createThreadSequence(
	options: {sequence?: number; highWaterMark?: number} = {},
) {
	let sequence = Math.max(
		validate(counter, options.sequence ?? 0),
		Math.floor(
			validate(counter, options.highWaterMark ?? 0) / THREAD_SEQUENCE_WIDTH,
		),
	);
	return {
		current: () => sequence,
		reserve(eventCount: number) {
			const count = validate(counter.max(MAX_THREAD_REPLAY_EVENTS), eventCount);
			const length = Math.max(1, Math.ceil(count / MAX_THREAD_BATCH_EVENTS));
			const batches = Array.from({length}, (_, index) => {
				const next = sequence + index + 1;
				const size = Math.min(
					MAX_THREAD_BATCH_EVENTS,
					count - index * MAX_THREAD_BATCH_EVENTS,
				);
				const firstSlot = next * THREAD_SEQUENCE_WIDTH;
				const highWaterMark = firstSlot + size;
				if (
					!Number.isSafeInteger(next) ||
					!Number.isSafeInteger(firstSlot) ||
					!Number.isSafeInteger(highWaterMark)
				)
					throw new IpcFailure(
						'UNAVAILABLE',
						'The thread sequence limit was reached',
					);
				return {sequence: next, count: size, firstSlot, highWaterMark};
			});
			sequence = batches.at(-1)?.sequence ?? sequence;
			return batches;
		},
	};
}
