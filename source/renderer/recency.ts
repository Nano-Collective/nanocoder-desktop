const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
}

export function dayAge(iso: string, now: Date): string | null {
	const then = new Date(iso);
	if (Number.isNaN(then.getTime())) return null;
	const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	return `${days} days ago`;
}

export function recencyLabel(iso: string, now: Date): string | null {
	const age = dayAge(iso, now);
	if (age === null) return null;
	const time = new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
	});
	return `${age}, ${time}`;
}

export function shortRoot(root: string): string {
	const match =
		/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)(.*)$/.exec(
			root,
		);
	if (!match) return root;
	const rest = match[1] ?? '';
	return `~${rest}`;
}
