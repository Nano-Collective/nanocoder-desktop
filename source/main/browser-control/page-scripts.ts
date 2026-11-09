// Fixed scripts the broker runs in an isolated world of the page (SEC-13). The page's own
// scripts cannot see or replace these helpers, and agent values only arrive as JSON data.

const HELPERS = String.raw`
	const state = globalThis.__ndBroker || (globalThis.__ndBroker = {refs: new Map(), ids: new WeakMap(), next: 0});
	const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
	const shown = el => {
		if (!el.isConnected) return false;
		const style = getComputedStyle(el);
		if (style.visibility === 'hidden' || style.display === 'none') return false;
		const rect = el.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const typeOf = el => clean(el.getAttribute('type'), 40).toLowerCase();
	const role = el => {
		const explicit = clean(el.getAttribute('role'), 40).split(' ')[0];
		if (explicit) return explicit;
		const tag = el.tagName.toLowerCase();
		if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
		if (tag === 'button' || tag === 'summary') return 'button';
		if (tag === 'select') return 'combobox';
		if (tag === 'textarea') return 'textbox';
		if (/^h[1-6]$/.test(tag)) return 'heading';
		if (tag === 'input') {
			const type = typeOf(el) || 'text';
			if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
			if (type === 'checkbox' || type === 'radio') return type;
			if (type === 'range') return 'slider';
			if (type === 'hidden') return '';
			return 'textbox';
		}
		if (el.isContentEditable && el.hasAttribute('contenteditable')) return 'textbox';
		return '';
	};
	const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox', 'radio', 'switch', 'slider', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
	const label = el => {
		const aria = clean(el.getAttribute('aria-label'), 200);
		if (aria) return aria;
		const by = el.getAttribute('aria-labelledby');
		if (by) {
			const text = clean(by.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '), 200);
			if (text) return text;
		}
		const tag = el.tagName.toLowerCase();
		if (el.labels && el.labels.length > 0) {
			const text = clean(Array.from(el.labels).map(item => item.innerText).join(' '), 200);
			if (text) return text;
		}
		if (tag === 'input') {
			const type = typeOf(el);
			if (['button', 'submit', 'reset'].includes(type)) return clean(el.value || type, 200);
			if (type === 'image') return clean(el.alt || 'image', 200);
			return clean(el.placeholder || el.title, 200);
		}
		if (tag === 'textarea') return clean(el.placeholder || el.title, 200);
		if (tag === 'img') return clean(el.alt, 200);
		return clean(el.innerText || el.textContent || el.title, 200);
	};
	const editable = el => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'textarea') return !el.readOnly && !el.disabled;
		if (tag === 'input') {
			const type = typeOf(el);
			return ['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password', 'date', 'time', 'datetime-local', 'month', 'week'].includes(type) && !el.readOnly && !el.disabled;
		}
		return el.isContentEditable === true;
	};
	const submits = el => {
		const button = el.closest('button, input[type=submit i], input[type=image i]');
		if (!button) return false;
		const form = button.form || button.closest('form');
		if (!form) return false;
		if (button.tagName.toLowerCase() === 'button') return (button.getAttribute('type') || 'submit').toLowerCase() === 'submit';
		return true;
	};
	const facts = el => ({
		tag: el.tagName.toLowerCase(),
		type: typeOf(el),
		role: role(el),
		name: clean(el.getAttribute('name'), 100),
		id: clean(el.id, 100),
		autocomplete: clean(el.getAttribute('autocomplete'), 100),
		label: label(el),
		submits: submits(el),
		download: !!el.closest('a[download]'),
		editable: editable(el),
		disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
	});
	const refFor = el => {
		const known = state.ids.get(el);
		if (known && state.refs.get(known) === el) return known;
		const ref = 'e' + (++state.next);
		state.refs.set(ref, el);
		state.ids.set(el, ref);
		return ref;
	};
	const resolve = target => {
		let el;
		if (target.ref) {
			el = state.refs.get(target.ref);
			if (!el || !el.isConnected) return {error: 'stale'};
		} else {
			try {
				el = document.querySelector(target.selector);
			} catch {
				return {error: 'selector'};
			}
			if (!el) return {error: 'missing'};
		}
		return {el};
	};
	const scrollState = () => ({
		x: Math.round(scrollX),
		y: Math.round(scrollY),
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
		viewWidth: innerWidth,
		viewHeight: innerHeight,
	});
`;

const script = (body: string) => `(args) => {${HELPERS}${body}}`;

export const PAGE_SCRIPTS = {
	viewport: script(`
		return {width: innerWidth, height: innerHeight};
	`),
	snapshot: script(`
		// A fresh snapshot retires earlier references; numbering never restarts, so an old one cannot name a new element.
		state.refs = new Map();
		state.ids = new WeakMap();
		const out = [];
		let size = 0;
		let truncated = false;
		let refs = 0;
		let visited = 0;
		const push = line => {
			if (truncated) return;
			if (size + line.length + 1 > args.maxChars) {
				truncated = true;
				return;
			}
			out.push(line);
			size += line.length + 1;
		};
		const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS']);
		const walk = node => {
			if (truncated) return;
			if (++visited > 20000) {
				truncated = true;
				return;
			}
			if (node.nodeType === 3) {
				const text = clean(node.textContent, 300);
				if (text) push(text);
				return;
			}
			if (node.nodeType !== 1) return;
			const el = node;
			if (SKIP.has(el.tagName.toUpperCase())) return;
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden' || el.hidden || el.getAttribute('aria-hidden') === 'true') return;
			const kind = role(el);
			if (INTERACTIVE.has(kind) && refs < 1000) {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 && rect.height === 0) return;
				refs++;
				let line = '[' + refFor(el) + '] ' + kind + ' "' + label(el) + '"';
				if (kind === 'link') line += ' -> ' + clean(el.getAttribute('href'), 200);
				if (typeOf(el) === 'password') line += ' value hidden';
				else if (editable(el) || el.tagName === 'SELECT') line += 'value' in el ? ' value="' + clean(el.value, 200) + '"' : ' text="' + clean(el.innerText, 200) + '"';
				if (kind === 'checkbox' || kind === 'radio' || kind === 'switch') line += el.checked === true || el.getAttribute('aria-checked') === 'true' ? ' checked' : ' unchecked';
				if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') line += ' disabled';
				push(line);
				return;
			}
			if (kind === 'heading') {
				const text = clean(el.innerText, 300);
				if (text) push('heading "' + text + '"');
				return;
			}
			if (el.tagName === 'IMG') {
				const alt = clean(el.getAttribute('alt'), 200);
				if (alt) push('img "' + alt + '"');
				return;
			}
			for (const child of el.childNodes) walk(child);
			if (el.shadowRoot) for (const child of el.shadowRoot.childNodes) walk(child);
		};
		if (document.body) walk(document.body);
		return {lines: out, truncated, refs, scroll: scrollState()};
	`),
	locate: script(`
		const found = resolve(args.target);
		if (found.error) return {error: found.error};
		const el = found.el;
		if (args.scroll) el.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
		const rect = el.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const inView = rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
		const root = el.getRootNode();
		const hit = inView ? (typeof root.elementFromPoint === 'function' ? root : document).elementFromPoint(x, y) : null;
		const viaLabel = !!hit && !!el.labels && Array.from(el.labels).some(item => item.contains(hit));
		return {
			ref: refFor(el),
			facts: facts(el),
			visible: shown(el),
			inView,
			hitOk: !!hit && (hit === el || el.contains(hit) || viaLabel),
			x: Math.round(x),
			y: Math.round(y),
		};
	`),
	prepareType: script(`
		const found = resolve({ref: args.ref});
		if (found.error) return {error: found.error};
		const el = found.el;
		el.focus();
		if (document.activeElement !== el && !el.contains(document.activeElement)) return {focused: false};
		if (el.isContentEditable) {
			const range = document.createRange();
			range.selectNodeContents(el);
			if (!args.clear) range.collapse(false);
			const selection = getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		} else if (args.clear && typeof el.select === 'function') {
			el.select();
		} else {
			try {
				el.setSelectionRange(el.value.length, el.value.length);
			} catch {}
		}
		return {focused: true};
	`),
	probe: script(`
		if (args.kind === 'selector') {
			let el;
			try {
				el = document.querySelector(args.value);
			} catch {
				return {error: 'selector'};
			}
			return {found: !!el && shown(el)};
		}
		return {found: (document.body ? document.body.innerText : '').includes(args.value)};
	`),
	scroll: script(`
		if (args.ref) {
			const found = resolve({ref: args.ref});
			if (found.error) return {error: found.error};
			found.el.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
		} else {
			window.scrollBy({left: args.dx, top: args.dy, behavior: 'instant'});
		}
		return scrollState();
	`),
} as const;

export type PageScript = keyof typeof PAGE_SCRIPTS;

// JSON is a JavaScript expression, so the values are data in the call and nothing more.
export function pageCall(script: string, args: unknown): string {
	return `(${script})(${JSON.stringify(args)})`;
}
