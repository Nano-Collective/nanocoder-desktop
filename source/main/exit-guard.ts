export type ExitChoice = 'wait' | 'cancel' | 'stay';

interface ExitEvent {
	preventDefault(): void;
}

export interface ExitGuardOptions {
	enabled(): boolean;
	// Projects with a turn that is running or waiting for the user.
	unfinished(): readonly string[];
	confirm(projectIds: readonly string[]): Promise<ExitChoice>;
	// Calls back whenever any project's activity changes; returns a function that stops it.
	onChange(listener: () => void): () => void;
}

// Quitting or closing a window must not end a turn silently (CHAT-22, `DEC-46`).
// It stops the exit, asks, and only goes on when the user said to or the turn ended.
export function createExitGuard(options: ExitGuardOptions) {
	const approved = new Set<string>();
	let prompting = false;
	let stopWaiting: (() => void) | undefined;

	const ask = (ids: readonly string[], proceed: () => void, scope: string) => {
		prompting = true;
		options
			.confirm(ids)
			.catch((): ExitChoice => 'stay')
			.then(choice => {
				prompting = false;
				if (choice === 'cancel') {
					approved.add(scope);
					proceed();
				} else if (choice === 'wait') {
					const finish = () => {
						if (options.unfinished().length > 0) return;
						stopWaiting?.();
						stopWaiting = undefined;
						approved.add(scope);
						proceed();
					};
					stopWaiting = options.onChange(finish);
					finish();
				}
			});
	};

	return {
		check(event: ExitEvent, proceed: () => void, scope: string): void {
			if (!options.enabled() || approved.has('quit') || approved.has(scope))
				return;
			const ids = options.unfinished();
			if (ids.length === 0) return;
			event.preventDefault();
			if (prompting) return;
			stopWaiting?.();
			stopWaiting = undefined;
			ask(ids, proceed, scope);
		},
		// A window that has closed no longer needs its approval.
		release(scope: string): void {
			approved.delete(scope);
		},
	};
}
