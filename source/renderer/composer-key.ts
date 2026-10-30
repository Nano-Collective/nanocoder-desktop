export interface ComposerKey {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
	keyCode?: number;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
}

export function composerEnter(event: ComposerKey): boolean {
	return (
		event.key === 'Enter' &&
		!event.shiftKey &&
		!event.isComposing &&
		event.keyCode !== 229 &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey
	);
}
