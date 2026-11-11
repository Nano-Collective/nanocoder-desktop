import test from 'ava';
import {
	retentionAnnouncement,
	retentionHint,
	retentionLabel,
} from '@/renderer/retention-notice';
import type {RetentionWarning, RetentionWarnings} from '@/shared/retention';

const warning = (daysLeft: number, id = 'a'): RetentionWarning => ({
	projectId: 'project',
	threadId: id,
	title: `thread ${id}`,
	idleDays: 30 - daysLeft,
	daysLeft,
});
const warnings = (
	threads: RetentionWarning[],
	reported = true,
): RetentionWarnings => ({
	retentionDays: 30,
	maxSessions: 100,
	reported,
	threads,
});

test('CHAT-23 labels how long a thread has before Nanocoder deletes it', t => {
	t.is(retentionLabel(warning(5)), 'deleted in 5 days');
	t.is(retentionLabel(warning(1)), 'deleted in 1 day');
	t.is(retentionLabel(warning(0)), 'may already be deleted');
});

test('DEC-45 the hint says what retention does, how to keep the chat and where to change the limits', t => {
	const hint = retentionHint(warnings([warning(3)]));
	t.regex(hint, /not opened for 30 days/);
	t.regex(hint, /oldest once there are more than 100/);
	t.regex(hint, /Open the chat to keep it/);
	t.regex(hint, /Nanocoder's session settings/);
	t.regex(retentionHint(warnings([warning(3)], false)), /^By default/);
});

test('CHAT-23 announces a set of at-risk threads once, and again only when the set changes', t => {
	const first = retentionAnnouncement(warnings([warning(3, 'a')]), '');
	t.truthy(first.message);
	t.regex(first.message ?? '', /1 chat may be deleted by Nanocoder soon/);
	const same = retentionAnnouncement(warnings([warning(2, 'a')]), first.key);
	t.is(same.message, null);
	t.is(same.key, first.key);
	const more = retentionAnnouncement(
		warnings([warning(2, 'a'), warning(1, 'b')]),
		first.key,
	);
	t.regex(more.message ?? '', /2 chats may be deleted by Nanocoder soon/);
	const none = retentionAnnouncement(warnings([]), more.key);
	t.is(none.message, null);
	t.is(none.key, '');
	t.is(retentionAnnouncement(null, first.key).message, null);
});
