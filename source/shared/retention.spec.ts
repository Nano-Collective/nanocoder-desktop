import test from 'ava';
import {missingSessionReason, REPLAY_MISSING_REASON} from '@/shared/retention';

test('DEC-45 the view-only notice names the defaults, the likely cause and where to change them', t => {
	t.is(
		REPLAY_MISSING_REASON,
		"Nanocoder no longer has this chat's history. By default it deletes chats not opened for 30 days, and the oldest once there are more than 100. You can change this in Nanocoder's session settings.",
	);
	t.is(missingSessionReason(undefined), REPLAY_MISSING_REASON);
});

test('DEC-45 once Nanocoder has reported its limits the notice states them instead of the defaults', t => {
	t.is(
		missingSessionReason({days: 90, maxSessions: 250}),
		"Nanocoder no longer has this chat's history. It deletes chats not opened for 90 days, and the oldest once there are more than 250. You can change this in Nanocoder's session settings.",
	);
	t.is(
		missingSessionReason({days: 1, maxSessions: 1}),
		"Nanocoder no longer has this chat's history. It deletes chats not opened for 1 day, and the oldest once there is more than 1. You can change this in Nanocoder's session settings.",
	);
});
