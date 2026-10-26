import path from 'node:path';

export const APP_SCHEME = 'app';
const APP_HOST = 'renderer';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// URL.origin is "null" for non-special schemes such as app:.
function originOf(url: string): string | null {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return null;
	}
}

export function isAllowedNavigation(
	url: string,
	allowedOrigins: readonly string[],
): boolean {
	const origin = originOf(url);
	return origin !== null && allowedOrigins.includes(origin);
}

export function resolveRendererFile(
	requestUrl: string,
	rendererRoot: string,
): string | null {
	let url: URL;
	try {
		url = new URL(requestUrl);
	} catch {
		return null;
	}
	if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
		return null;
	}

	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	// Backslashes are separators on Windows; refuse them everywhere.
	if (pathname.includes('\0') || pathname.includes('\\')) {
		return null;
	}

	const relative =
		pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
	const root = path.resolve(rendererRoot);
	const resolved = path.resolve(root, relative);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		return null;
	}
	return resolved;
}

export function contentSecurityPolicy(devServerUrl?: string): string {
	const connect = ["'self'"];
	const style = ["'self'"];
	if (devServerUrl) {
		connect.push(`ws://${new URL(devServerUrl).host}`);
		style.push("'unsafe-inline'");
	}
	return [
		"default-src 'none'",
		"script-src 'self'",
		`style-src ${style.join(' ')}`,
		"img-src 'self' data:",
		"font-src 'self'",
		`connect-src ${connect.join(' ')}`,
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join('; ');
}
