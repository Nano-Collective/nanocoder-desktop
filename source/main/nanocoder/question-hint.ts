import type {
	RequestPermissionRequest,
	SessionNotification,
	ToolCall,
} from '@agentclientprotocol/sdk';

const MAX_TOOL_CALLS = 256;
const MAX_QUESTION_BYTES = 2048;
const MAX_LABEL_BYTES = 512;
const MIN_CHOICES = 2;
const MAX_CHOICES = 6;

interface Announced {
	question: string;
	labels: string[];
}

function label(value: unknown, maxBytes: number): string | undefined {
	return typeof value === 'string' &&
		value.trim().length > 0 &&
		new TextEncoder().encode(value).length <= maxBytes &&
		!/\p{Cc}|\p{Cf}/u.test(value)
		? value
		: undefined;
}

// Only Nanocoder's ask_user call has this kind, question and labelled choices.
function questionShape(update: ToolCall): Announced | null {
	if (update.kind !== 'other') return null;
	const input = update.rawInput;
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const question = label(
		Object.getOwnPropertyDescriptor(input, 'question')?.value,
		MAX_QUESTION_BYTES,
	);
	const options = Object.getOwnPropertyDescriptor(input, 'options')?.value;
	if (
		!question ||
		!Array.isArray(options) ||
		options.length < MIN_CHOICES ||
		options.length > MAX_CHOICES
	)
		return null;
	const labels: string[] = [];
	for (const option of options) {
		// Object or empty options are normalised by Nanocoder, so they get no hint.
		const text = label(option, MAX_LABEL_BYTES);
		if (!text) return null;
		labels.push(text);
	}
	return {question, labels};
}

// Nanocoder reports no tool name for ask_user, so its question is matched by shape.
// The match is display only: it never adds answer authority.
export class QuestionHints {
	private readonly announced = new Map<string, Announced | null>();

	constructor(private readonly sessionId: string) {}

	observe(notification: SessionNotification): void {
		const {update} = notification;
		if (
			notification.sessionId !== this.sessionId ||
			update.sessionUpdate !== 'tool_call'
		)
			return;
		const id = update.toolCallId;
		// A reused id is ambiguous, so it never gets a hint.
		if (this.announced.has(id)) {
			this.announced.set(id, null);
			return;
		}
		if (this.announced.size >= MAX_TOOL_CALLS) return;
		this.announced.set(id, questionShape(update));
	}

	matches(request: RequestPermissionRequest): boolean {
		if (request.sessionId !== this.sessionId) return false;
		const announced = this.announced.get(request.toolCall.toolCallId);
		if (!announced || request.toolCall.title !== announced.question)
			return false;
		const {options} = request;
		return (
			options.length === announced.labels.length &&
			options.every(
				(option, index) =>
					option.optionId === `answer-${index}` &&
					option.kind === 'allow_once' &&
					option.name === announced.labels[index],
			)
		);
	}

	clear(): void {
		this.announced.clear();
	}
}
