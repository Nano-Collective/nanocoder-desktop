// The per-session switch Nanocoder 1.32.0 reads on new, load and resume, and echoes back (DEC-48).
export const DISABLED_TOOLS_META = 'nanocoder/disabledTools';

export function disabledToolsMeta(tools: readonly string[]): {
	_meta?: Record<string, string[]>;
} {
	return tools.length > 0 ? {_meta: {[DISABLED_TOOLS_META]: [...tools]}} : {};
}

export function confirmsDisabledTools(
	requested: readonly string[],
	meta: unknown,
): boolean {
	if (requested.length === 0) return true;
	if (typeof meta !== 'object' || meta === null) return false;
	const echoed = (meta as Record<string, unknown>)[DISABLED_TOOLS_META];
	return (
		Array.isArray(echoed) && echoed.every(name => typeof name === 'string')
	);
}
