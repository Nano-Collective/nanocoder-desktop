// Nanocoder's defaults, used until it reports its own limits (DEC-45).
export const DEFAULT_RETENTION = {days: 30, maxSessions: 100} as const;

export interface RetentionWarning {
	projectId: string;
	threadId: string;
	title: string;
	idleDays: number;
	daysLeft: number;
}

export interface RetentionWarnings {
	retentionDays: number;
	maxSessions: number;
	// False while the limits are Nanocoder's defaults, not what it reported.
	reported: boolean;
	threads: RetentionWarning[];
}

const plural = (count: number, one: string, many: string) =>
	count === 1 ? one : many;

// The view-only notice from DEC-45. A missing session and an unknown ID look the same to Nanocoder, so retention is the likely cause, not a certainty.
export function missingSessionReason(
	reported?: {days: number; maxSessions: number} | undefined,
): string {
	const limits = reported ?? DEFAULT_RETENTION;
	const lead = reported ? 'It deletes' : 'By default it deletes';
	return `Nanocoder no longer has this chat's history. ${lead} chats not opened for ${limits.days} ${plural(limits.days, 'day', 'days')}, and the oldest once there ${plural(limits.maxSessions, 'is', 'are')} more than ${limits.maxSessions}. You can change this in Nanocoder's session settings.`;
}

export const REPLAY_MISSING_REASON = missingSessionReason();
