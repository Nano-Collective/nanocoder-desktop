export type PageCheck =
	| {allowed: true; local: boolean}
	| {allowed: false; reason: 'scheme' | 'public-off' | 'invalid'};

export function isLoopbackPage(value: string): boolean {
	const result = checkPage(value, {publicSites: false});
	return result.allowed && result.local;
}

export function checkPage(
	value: string,
	options: {publicSites: boolean},
): PageCheck {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return {allowed: false, reason: 'invalid'};
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		return {allowed: false, reason: 'scheme'};
	if (url.username !== '' || url.password !== '')
		return {allowed: false, reason: 'invalid'};
	const host = url.hostname;
	if (
		host === 'localhost' ||
		host === '[::1]' ||
		/^127(\.\d{1,3}){3}$/.test(host)
	)
		return {allowed: true, local: true};
	return options.publicSites
		? {allowed: true, local: false}
		: {allowed: false, reason: 'public-off'};
}

export function pageOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.origin
			: null;
	} catch {
		return null;
	}
}

export function pageSecurity(
	value: string,
): 'local' | 'secure' | 'insecure' | null {
	const check = checkPage(value, {publicSites: true});
	if (!check.allowed) return null;
	if (check.local) return 'local';
	return new URL(value).protocol === 'https:' ? 'secure' : 'insecure';
}
