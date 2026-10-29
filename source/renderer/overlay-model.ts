export interface PaletteAction {
	id: string;
	label: string;
	glyph: string;
	shortcut?: string;
	keywords?: string;
	disabledReason?: string;
	run(): void;
}

export function filterActions(actions: PaletteAction[], query: string) {
	const text = query.trim().toLocaleLowerCase();
	if (!text) return actions;
	const words = text.split(/\s+/);
	return actions
		.map((action, index) => {
			const label = action.label.toLocaleLowerCase();
			const searchable =
				`${label} ${action.keywords ?? ''}`.toLocaleLowerCase();
			const rank =
				label === text
					? 0
					: label.startsWith(text)
						? 1
						: words.every(word => label.includes(word))
							? 2
							: 3;
			return {
				action,
				index,
				rank,
				matches: words.every(word => searchable.includes(word)),
			};
		})
		.filter(item => item.matches)
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(item => item.action);
}

export function moveSelection(index: number, delta: number, length: number) {
	if (!length) return -1;
	if (index < 0 || index >= length) return 0;
	return (index + delta + length) % length;
}

export function runAction(action: PaletteAction | undefined) {
	if (!action || action.disabledReason) return false;
	action.run();
	return true;
}

export interface FocusTarget {
	isConnected: boolean;
	disabled?: boolean;
	focus(): void;
}

export function focusReturn(target: FocusTarget | null, fallback: FocusTarget) {
	return () => {
		if (target?.isConnected && !target.disabled) target.focus();
		else if (fallback.isConnected && !fallback.disabled) fallback.focus();
	};
}

export interface Toast {
	id: number;
	message: string;
	exiting: boolean;
}

export interface Clock {
	schedule(callback: () => void, delay: number): () => void;
}

export function toastQueue(
	clock: Clock,
	changed: (toast: Toast | null) => void,
) {
	const pending: Toast[] = [];
	let sequence = 0;
	let active = false;
	let disposed = false;
	let cancel: (() => void) | undefined;
	const next = () => {
		const toast = pending.shift();
		active = !!toast;
		if (!toast) {
			changed(null);
			return;
		}
		changed(toast);
		cancel = clock.schedule(() => {
			changed({...toast, exiting: true});
			cancel = clock.schedule(next, 180);
		}, 2400);
	};
	return {
		push(message: string) {
			if (disposed) return;
			pending.push({id: ++sequence, message, exiting: false});
			if (!active) next();
		},
		dispose() {
			disposed = true;
			cancel?.();
			pending.length = 0;
		},
	};
}
