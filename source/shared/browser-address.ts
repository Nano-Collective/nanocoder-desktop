const LOCAL_ADDRESS =
	/^(?:localhost|127(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#]|$)/i;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const OTHER_SCHEME =
	/^(?:javascript|data|file|about|blob|view-source|chrome|mailto|ftp):/i;

export function addressToUrl(input: string): string {
	const value = input.trim();
	if (value === '') return '';
	if (LOCAL_ADDRESS.test(value)) return `http://${value}`;
	if (EXPLICIT_SCHEME.test(value) || OTHER_SCHEME.test(value)) return value;
	return `https://${value}`;
}
