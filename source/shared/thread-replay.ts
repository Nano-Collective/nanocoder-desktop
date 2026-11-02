import {z} from 'zod';

export const threadReplaySchema = z.strictObject({
	epoch: z.uuid(),
	phase: z.enum(['begin', 'complete', 'failed']),
});

export const threadReplaySnapshotSchema = z.strictObject({
	replaying: z.boolean(),
	replayEpoch: z.uuid().optional(),
});

export const REPLAY_REASON =
	'restoring saved history; sending and controls will be available when it finishes';
export const REPLAY_FAILURE_REASON =
	'saved history could not be restored; retry this thread before sending';
export const REPLAY_MISSING_REASON =
	"nanocoder can't find this session · it may have been deleted, expired or never saved";
