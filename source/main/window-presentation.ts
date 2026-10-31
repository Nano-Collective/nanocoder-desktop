export const E2E_HIDDEN_SWITCH = '--nanocoder-e2e-hidden';

export function hiddenTestWindows(
	isPackaged: boolean,
	args: readonly string[],
) {
	return !isPackaged && args.includes(E2E_HIDDEN_SWITCH);
}

interface NativeWindow {
	isMinimized(): boolean;
	restore(): void;
	show(): void;
	focus(): void;
}

export function presentWindow(window: NativeWindow, hidden: boolean): void {
	if (hidden) return;
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
}
