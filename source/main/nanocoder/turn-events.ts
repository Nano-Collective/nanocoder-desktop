import type {
	ContentBlock,
	PlanEntry,
	SessionNotification,
	ToolCall,
	ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import {
	type MetadataWarning,
	parseTurnMetadata,
} from '@/main/nanocoder/turn-metadata';
import type {StreamToolDetails, TurnEvent} from '@/shared/ipc';

const bounded = (text: string) =>
	text.length > 16_384 ? `${text.slice(0, 16_384)}\n[display truncated]` : text;

function contentText(content: ContentBlock): string {
	switch (content.type) {
		case 'text':
			return content.text;
		case 'image':
			return '[image not displayed]';
		case 'audio':
			return '[audio not played]';
		case 'resource':
			return '[embedded resource not displayed]';
		case 'resource_link':
			return `[resource: ${content.name.slice(0, 256)} (not opened)]`;
	}
}

const contentList = (content: ContentBlock[]) =>
	content.map(contentText).join('\n');
const planEntries = (entries: PlanEntry[]) =>
	entries.slice(0, 200).map(entry => ({
		content: bounded(entry.content),
		priority: entry.priority,
		status: entry.status,
	}));

function displayValue(value: unknown): string {
	try {
		return bounded(
			typeof value === 'string'
				? value
				: (JSON.stringify(value) ?? '[unavailable]'),
		);
	} catch {
		return '[unavailable]';
	}
}

function toolDetails(
	update: ToolCall | ToolCallUpdate,
): StreamToolDetails | undefined {
	const details: StreamToolDetails = {};
	if (update.content)
		details.content = update.content.slice(0, 64).map(content => {
			switch (content.type) {
				case 'content':
					return bounded(contentText(content.content));
				case 'diff':
					return bounded(
						`diff ${content.path}\n---\n${content.oldText ?? ''}\n+++\n${content.newText}`,
					);
				case 'terminal':
					return '[agent terminal output unavailable]';
			}
		});
	if (update.locations)
		details.locations = update.locations.slice(0, 64).map(location => ({
			path: bounded(location.path),
			...(typeof location.line === 'number' ? {line: location.line} : {}),
		}));
	if (update.rawInput !== undefined)
		details.input = displayValue(update.rawInput);
	if (update.rawOutput !== undefined)
		details.output = displayValue(update.rawOutput);
	return Object.keys(details).length ? details : undefined;
}

function ignoreUnsupported(_update: never): undefined {
	return undefined;
}

// The user's own message is shown when it is sent, so a live update never maps it;
// only a resume's replay does (`history`).
function mapUpdate(
	update: SessionNotification['update'],
	history: boolean,
): TurnEvent | undefined {
	switch (update.sessionUpdate) {
		case 'available_commands_update':
			return {
				type: 'commands',
				commands: update.availableCommands.slice(0, 200).map(command => ({
					name: command.name,
					description: bounded(command.description),
					...(command.input ? {inputHint: bounded(command.input.hint)} : {}),
				})),
			};
		case 'agent_thought_chunk':
		case 'agent_message_chunk':
		case 'user_message_chunk': {
			if (update.sessionUpdate === 'user_message_chunk' && !history)
				return undefined;
			const text = contentText(update.content);
			if (!text) return undefined;
			return {
				type:
					update.sessionUpdate === 'agent_thought_chunk'
						? 'thought'
						: update.sessionUpdate === 'agent_message_chunk'
							? 'text'
							: 'user',
				text,
				...(update.messageId ? {messageId: update.messageId} : {}),
			};
		}
		case 'tool_call':
		case 'tool_call_update': {
			const details = toolDetails(update);
			return {
				type: 'tool',
				id: update.toolCallId,
				title: update.title ?? undefined,
				...(update.kind ? {toolKind: update.kind} : {}),
				status:
					update.status ??
					(update.sessionUpdate === 'tool_call' ? 'pending' : undefined),
				...(details ? {details} : {}),
			};
		}
		case 'plan':
			return {
				type: 'plan',
				id: null,
				content: {kind: 'items', entries: planEntries(update.entries)},
			};
		case 'plan_update': {
			const {plan} = update;
			return {
				type: 'plan',
				id: plan.planId,
				content:
					plan.type === 'items'
						? {kind: 'items', entries: planEntries(plan.entries)}
						: plan.type === 'markdown'
							? {kind: 'markdown', text: bounded(plan.content)}
							: {kind: 'file', uri: bounded(plan.uri)},
			};
		}
		case 'plan_removed':
			return {type: 'plan', id: update.planId, content: null};
		case 'current_mode_update':
			return {type: 'mode', id: bounded(update.currentModeId)};
		case 'config_option_update':
			return {
				type: 'config',
				options: update.configOptions.slice(0, 200).map(option => ({
					id: option.id,
					name: bounded(option.name),
					value:
						typeof option.currentValue === 'string'
							? bounded(option.currentValue)
							: option.currentValue,
				})),
			};
		case 'session_info_update':
			// ThreadService owns titles; this stream never parses or displays them.
			return undefined;
		case 'usage_update':
			if (
				!Number.isSafeInteger(update.used) ||
				update.used < 0 ||
				!Number.isSafeInteger(update.size) ||
				update.size <= 0
			)
				return undefined;
			return {
				type: 'context',
				used: update.used,
				size: update.size,
				...(update.cost &&
				Number.isFinite(update.cost.amount) &&
				update.cost.amount >= 0
					? {
							cost: {
								amount: update.cost.amount,
								currency: update.cost.currency.slice(0, 16),
							},
						}
					: {}),
			};
		case 'notice':
			return history
				? undefined
				: {
						type: 'notice',
						severity: update.severity.slice(0, 64),
						title: bounded(update.title),
						...(update.description
							? {description: bounded(update.description)}
							: {}),
					};
		case 'compaction_update':
			return {
				type: 'compaction',
				id: update.compactionId,
				status: update.status.slice(0, 64),
				...(update.summary === undefined
					? {}
					: {
							summary:
								update.summary === null
									? null
									: bounded(contentList(update.summary)),
						}),
				...(update.error === undefined
					? {}
					: {error: update.error === null ? null : bounded(update.error)}),
			};
		case 'compaction_summary_chunk':
			return {
				type: 'compaction-chunk',
				id: update.compactionId,
				text: bounded(contentText(update.content)),
			};
		case 'subagent_update':
			return {
				type: 'subagent',
				id: update.sessionId,
				...(update.title === undefined
					? {}
					: {title: update.title === null ? null : bounded(update.title)}),
				...(update.description === undefined
					? {}
					: {
							description:
								update.description === null
									? null
									: bounded(update.description),
						}),
				...(update.state === undefined
					? {}
					: {
							state:
								update.state === null
									? null
									: ['running', 'idle', 'requires_action', 'unknown'].includes(
												update.state.state,
											)
										? update.state.state
										: 'unknown',
						}),
			};
		case 'session_message':
		case 'session_message_chunk':
			return {
				type: 'session-message',
				id: update.messageId,
				...(update.senderSessionId ? {sender: update.senderSessionId} : {}),
				...(update.recipientSessionId
					? {recipient: update.recipientSessionId}
					: {}),
				...(update.content === undefined
					? {}
					: {
							text:
								update.content === null
									? ''
									: Array.isArray(update.content)
										? bounded(contentList(update.content))
										: bounded(contentText(update.content)),
						}),
				append: update.sessionUpdate === 'session_message_chunk',
			};
		default:
			return ignoreUnsupported(update);
	}
}

export function toTurnEvent(
	update: SessionNotification['update'],
	{
		history = false,
		onMalformed,
	}: {history?: boolean; onMalformed?: MetadataWarning} = {},
): TurnEvent | undefined {
	const metadata = parseTurnMetadata(update._meta, onMalformed);
	const event = mapUpdate(update, history);
	if (!metadata) return event;
	return event ? {...event, metadata} : {type: 'metadata', metadata};
}
