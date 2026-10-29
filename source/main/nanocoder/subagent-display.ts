import {
	type SubagentDisplay,
	type SubagentPermissionSource,
	subagentLabel,
} from '@/shared/subagents';

export function delegationDisplay(
	update: {kind?: unknown; title?: unknown; rawInput?: unknown},
	history: boolean,
): SubagentDisplay | undefined {
	const input = update.rawInput;
	const record =
		input && typeof input === 'object' && !Array.isArray(input)
			? input
			: undefined;
	const role = subagentLabel(
		record && Object.getOwnPropertyDescriptor(record, 'subagent_type')?.value,
		160,
	);
	const task = subagentLabel(
		record && Object.getOwnPropertyDescriptor(record, 'description')?.value,
	);
	if (
		!(update.kind === 'think' && role) &&
		!(
			(update.kind === undefined || update.kind === 'think') &&
			update.title === 'agent'
		)
	)
		return undefined;
	return {history, ...(role ? {role} : {}), ...(task ? {task} : {})};
}

export function permissionSource(toolCall: {
	toolCallId: string;
	title?: string | null;
}): SubagentPermissionSource | undefined {
	const toolCallId = subagentLabel(toolCall.toolCallId, 512);
	if (!toolCallId?.startsWith('subagent:') || toolCallId.length === 9)
		return undefined;
	const label = subagentLabel(toolCall.title);
	return {kind: 'subagent', toolCallId, ...(label ? {label} : {})};
}
