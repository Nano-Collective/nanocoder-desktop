export function isLoopbackPage(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	if (url.username !== '' || url.password !== '') return false;
	const host = url.hostname;
	return (
		host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)
	);
}
