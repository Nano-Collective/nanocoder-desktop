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
	const owned = new Set<S>();
	let stopped = false;
	const apply = () => {
		if (stopped) return;
		const live = new Set<E>();
		for (const element of host.styles()) {
			live.add(element);
			let sheet = mirrored.get(element);
			if (!sheet) {
				sheet = host.createSheet();
				mirrored.set(element, sheet);
				owned.add(sheet);
			}
			sheet.replaceSync(element.textContent ?? '');
		}
		for (const element of mirrored.keys())
			if (!live.has(element)) mirrored.delete(element);
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
	};
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
			const observer = new MutationObserver(onChange);
			observer.observe(root, {
				childList: true,
				subtree: true,
				characterData: true,
			});
			return () => observer.disconnect();
		},
	});
}
