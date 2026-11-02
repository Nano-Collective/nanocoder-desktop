export type RetryFocusTarget = 'body' | 'composer' | 'other';

export type RetryFocusComposer = 'missing' | 'disabled' | 'enabled';

export interface RetryFocusInput {
	intent: boolean;
	retrying: boolean;
	sameScope: boolean;
	dialogOpen: boolean;
	composer: RetryFocusComposer;
	active: RetryFocusTarget;
}

export interface RetryFocusStep {
	intent: boolean;
	focus: boolean;
}

// The intent survives focusing the composer: a workspace reload can disable
// it again and drop focus, so only the user moving elsewhere ends it.
export function stepRetryFocus(input: RetryFocusInput): RetryFocusStep {
	if (!input.intent) return {intent: false, focus: false};
	if (
		input.composer === 'missing' ||
		input.dialogOpen ||
		!input.sameScope ||
		(!input.retrying && input.active === 'other')
	)
		return {intent: false, focus: false};
	if (input.active === 'body' && input.composer === 'enabled')
		return {intent: true, focus: true};
	return {intent: true, focus: false};
}
