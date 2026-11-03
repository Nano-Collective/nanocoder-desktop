// xterm writes its colour, cursor and scrollbar rules into <style> elements, which the
// strict style policy refuses to apply. Mirroring them into adopted sheets keeps the policy.
export interface SheetLike {
	replaceSync(text: string): void;
}

export interface StyleHost<S extends SheetLike, E extends object> {
	styles(): Iterable<E & {textContent: string | null}>;
	adopted: S[];
	createSheet(): S;
	// Calls back after any change under the terminal; returns a function that stops it.
	watch(onChange: () => void): () => void;
}

export function mirrorStyles<S extends SheetLike, E extends object>(
	host: StyleHost<S, E>,
): () => void {
	const mirrored = new Map<E, S>();
	const texts = new Map<E, string>();
	const owned = new Set<S>();
	let stopped = false;
	const apply = () => {
		if (stopped) return;
		const live = new Set<E>();
		let membership = false;
		for (const element of host.styles()) {
			live.add(element);
			let sheet = mirrored.get(element);
			if (!sheet) {
				sheet = host.createSheet();
				mirrored.set(element, sheet);
				owned.add(sheet);
				membership = true;
			}
			// Re-parsing is skipped when xterm rewrote nothing, as on most output.
			const text = element.textContent ?? '';
			if (texts.get(element) !== text) {
				sheet.replaceSync(text);
				texts.set(element, text);
			}
		}
		for (const element of mirrored.keys())
			if (!live.has(element)) {
				mirrored.delete(element);
				texts.delete(element);
				membership = true;
			}
		// Assigning the list restyles the whole document, so only do it when the set changed.
		if (membership)
			host.adopted = [
				...host.adopted.filter(sheet => !owned.has(sheet)),
				...mirrored.values(),
			];
	};
	const unwatch = host.watch(apply);
	apply();
	return () => {
		unwatch();
		stopped = true;
		host.adopted = host.adopted.filter(sheet => !owned.has(sheet));
		mirrored.clear();
		texts.clear();
	};
}

interface NodeLike {
	nodeName: string;
	parentNode?: {nodeName: string} | null;
}

// xterm rewrites rows on every output batch, so only a change that involves a style
// element, or the text inside one, needs the mirror to look again.
export function touchesStyle(record: {
	target: NodeLike;
	addedNodes: ArrayLike<{nodeName: string}>;
	removedNodes: ArrayLike<{nodeName: string}>;
}): boolean {
	const style = (node: {nodeName: string} | null | undefined) =>
		node?.nodeName === 'STYLE';
	return (
		style(record.target) ||
		style(record.target.parentNode) ||
		Array.from(record.addedNodes).some(style) ||
		Array.from(record.removedNodes).some(style)
	);
}

export function mirrorTerminalStyles(root: HTMLElement): () => void {
	const document = root.ownerDocument;
	return mirrorStyles<CSSStyleSheet, HTMLStyleElement>({
		styles: () => root.querySelectorAll('style'),
		get adopted() {
			return [...document.adoptedStyleSheets];
		},
		set adopted(sheets) {
			document.adoptedStyleSheets = sheets;
		},
		createSheet: () => new CSSStyleSheet(),
		watch: onChange => {
			const observer = new MutationObserver(records => {
				if (records.some(touchesStyle)) onChange();
			});
			observer.observe(root, {
				childList: true,
				subtree: true,
				characterData: true,
			});
			return () => observer.disconnect();
		},
	});
}
