export interface SubagentDisplay {
	role?: string;
	task?: string;
	history: boolean;
}

export interface SubagentPermissionSource {
	kind: 'subagent';
	toolCallId: string;
	label?: string;
}

export function subagentLabel(
	value: unknown,
	maxBytes = 2048,
): string | undefined {
	return typeof value === 'string' &&
		value.trim().length > 0 &&
		new TextEncoder().encode(value).length <= maxBytes &&
		!/\p{Cc}|\p{Cf}/u.test(value)
		? value
		: undefined;
}
