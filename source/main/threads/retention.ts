import type {DesktopStore, ThreadRetentionRow} from '@/main/store/contracts';
import {DEFAULT_RETENTION, type RetentionWarnings} from '@/shared/retention';

const DAY = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 7;
const MAX_LISTED = 50;

// Threads whose saved session Nanocoder is about to delete for being idle, from the desktop's own last activity (CHAT-23).
export function retentionWarnings(
	rows: readonly ThreadRetentionRow[],
	limits: {days: number; maxSessions: number},
	reported: boolean,
	now: Date,
): RetentionWarnings {
	const window = Math.min(WARNING_DAYS, Math.floor(limits.days / 2));
	const threads = rows.flatMap(row => {
		const at = Date.parse(row.lastActivityAt);
		if (!Number.isFinite(at) || at > now.getTime()) return [];
		const idleDays = Math.floor((now.getTime() - at) / DAY);
		const daysLeft = Math.max(0, limits.days - idleDays);
		return window >= 1 && daysLeft <= window
			? [
					{
						projectId: row.projectId,
						threadId: row.threadId,
						title: row.title,
						idleDays,
						daysLeft,
					},
				]
			: [];
	});
	threads.sort((a, b) => a.daysLeft - b.daysLeft || b.idleDays - a.idleDays);
	return {
		retentionDays: limits.days,
		maxSessions: limits.maxSessions,
		reported,
		threads: threads.slice(0, MAX_LISTED),
	};
}

// The warnings for every project, from metadata only and the limits Nanocoder last reported.
export function retentionWarningsFromStore(
	store: Pick<DesktopStore, 'retention' | 'threads'>,
	now: Date,
): RetentionWarnings {
	const known = store.retention.get();
	return retentionWarnings(
		store.threads.listUnpinnedSessions(),
		known ?? DEFAULT_RETENTION,
		known !== undefined,
		now,
	);
}
