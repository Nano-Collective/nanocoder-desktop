import type {RetentionWarning, RetentionWarnings} from '@/shared/retention';

export function retentionLabel(warning: RetentionWarning): string {
	if (warning.daysLeft <= 0) return 'may already be deleted';
	return `deleted in ${warning.daysLeft} ${warning.daysLeft === 1 ? 'day' : 'days'}`;
}

// DEC-45: say what retention does and where to change it. The desktop never edits Nanocoder's settings.
export function retentionHint(warnings: RetentionWarnings): string {
	const lead = warnings.reported
		? 'Nanocoder deletes'
		: 'By default Nanocoder deletes';
	return `${lead} chats not opened for ${warnings.retentionDays} days, and the oldest once there ${warnings.maxSessions === 1 ? 'is' : 'are'} more than ${warnings.maxSessions}. Open the chat to keep it. You can change the limits in Nanocoder's session settings.`;
}

// One announcement per set of at-risk threads, so a refresh does not repeat it.
export function retentionAnnouncement(
	warnings: RetentionWarnings | null,
	announcedKey: string,
): {message: string | null; key: string} {
	const ids = (warnings?.threads ?? []).map(item => item.threadId).sort();
	const key = ids.join('\n');
	if (ids.length === 0) return {message: null, key: ''};
	if (key === announcedKey) return {message: null, key};
	return {
		message: `${ids.length} ${ids.length === 1 ? 'chat' : 'chats'} may be deleted by Nanocoder soon. open them to keep them.`,
		key,
	};
}
