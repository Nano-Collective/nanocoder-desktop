import type {Terminal} from '@xterm/xterm';
import * as React from 'react';
import {terminalFocusLease} from '@/renderer/terminal-focus';
import {TerminalOutput} from '@/renderer/terminal-output';

export interface TerminalHandle {
	focus(): void;
}

export function leavesTerminal(
	event: Pick<
		KeyboardEvent,
		'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
	>,
): boolean {
	return (
		event.key === 'Tab' &&
		event.ctrlKey &&
		event.shiftKey &&
		!event.altKey &&
		!event.metaKey
	);
}

export function TerminalView(props: {
	ref: React.Ref<TerminalHandle>;
	output: string;
	running: boolean;
	screenReader: boolean;
	onData(data: string): void;
	onResize(cols: number, rows: number): void;
	onExit(): void;
	onFailure(): void;
}) {
	const host = React.useRef<HTMLDivElement>(null);
	const instance = React.useRef<Terminal | null>(null);
	const latest = React.useRef(props);
	latest.current = props;
	const focusPending = React.useRef<ReturnType<
		typeof terminalFocusLease
	> | null>(null);
	const sync = React.useRef<() => void>(() => {});
	React.useImperativeHandle(
		props.ref,
		() => ({
			focus() {
				if (instance.current) instance.current.focus();
				else {
					focusPending.current?.dispose();
					focusPending.current = terminalFocusLease(
						document,
						document.activeElement ?? document.body,
					);
				}
			},
		}),
		[],
	);

	React.useEffect(() => {
		const element = host.current;
		if (!element) return;
		let disposed = false;
		let frame = 0;
		let resize: ResizeObserver | undefined;
		let theme: MutationObserver | undefined;
		let subscription: {dispose(): void} | undefined;
		let output: TerminalOutput | undefined;
		const initialise = async () => {
			await document.fonts.ready;
			const {Terminal} = await import('@xterm/xterm');
			if (disposed) return;
			const terminal = new Terminal({
				cols: 80,
				rows: 8,
				scrollback: 10_000,
				cursorBlink: false,
				fontWeight: 'normal',
				fontWeightBold: 'normal',
				allowProposedApi: false,
				disableStdin: !latest.current.running,
				linkHandler: {activate() {}},
			});
			instance.current = terminal;
			const style = () => {
				const css = getComputedStyle(element);
				const color = (name: string) =>
					css.getPropertyValue(`--colors-${name}`).trim();
				terminal.options.fontFamily = css
					.getPropertyValue('--components-terminal-font-family')
					.trim();
				terminal.options.fontSize = Number.parseFloat(
					css.getPropertyValue('--components-terminal-font-size'),
				);
				terminal.options.lineHeight = Number.parseFloat(
					css.getPropertyValue('--components-terminal-line-height'),
				);
				terminal.options.theme = {
					background: color('surface-panel'),
					foreground: color('on-surface'),
					cursor: color('primary'),
					cursorAccent: color('surface-panel'),
					selectionBackground: color('primary-soft'),
					selectionForeground: color('on-surface'),
					black: color('on-surface-muted'),
					brightBlack: color('on-surface-muted'),
					red: color('error'),
					brightRed: color('error'),
					green: color('success'),
					brightGreen: color('success'),
					yellow: color('warning'),
					brightYellow: color('warning'),
					blue: color('primary'),
					brightBlue: color('primary'),
					magenta: color('heading'),
					brightMagenta: color('heading'),
					cyan: color('mention'),
					brightCyan: color('mention'),
					white: color('on-surface'),
					brightWhite: color('on-surface'),
				};
			};
			style();
			terminal.open(element);
			terminal.textarea?.setAttribute('aria-label', 'your terminal input');
			terminal.textarea?.setAttribute('aria-describedby', 'terminal-help');
			terminal.textarea?.setAttribute('aria-keyshortcuts', 'Control+Shift+Tab');
			terminal.attachCustomKeyEventHandler(event => {
				if (!leavesTerminal(event)) return true;
				if (event.type === 'keydown') {
					event.preventDefault();
					event.stopPropagation();
					latest.current.onExit();
				}
				return false;
			});
			subscription = terminal.onData(data => latest.current.onData(data));
			const fit = () => {
				const screen = element
					.querySelector('.xterm-screen')
					?.getBoundingClientRect();
				if (
					!screen?.width ||
					!screen.height ||
					!element.clientWidth ||
					!element.clientHeight
				)
					return;
				const cols = Math.max(
					2,
					Math.min(
						500,
						Math.floor(
							(element.clientWidth - 16) / (screen.width / terminal.cols),
						),
					),
				);
				const rows = Math.max(
					2,
					Math.min(
						500,
						Math.floor(element.clientHeight / (screen.height / terminal.rows)),
					),
				);
				if (cols !== terminal.cols || rows !== terminal.rows)
					terminal.resize(cols, rows);
				latest.current.onResize(cols, rows);
			};
			output = new TerminalOutput(terminal);
			sync.current = () => {
				terminal.options.disableStdin = !latest.current.running;
				terminal.options.screenReaderMode = latest.current.screenReader;
				output?.update(latest.current.output);
				fit();
			};
			resize = new ResizeObserver(() => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(fit);
			});
			resize.observe(element);
			theme = new MutationObserver(() => {
				style();
				fit();
			});
			theme.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme'],
			});
			sync.current();
			if (focusPending.current?.canReturn()) terminal.focus();
			focusPending.current?.dispose();
			focusPending.current = null;
		};
		void initialise().catch(() => {
			if (!disposed) latest.current.onFailure();
		});
		return () => {
			disposed = true;
			focusPending.current?.dispose();
			focusPending.current = null;
			cancelAnimationFrame(frame);
			resize?.disconnect();
			theme?.disconnect();
			subscription?.dispose();
			output?.dispose();
			instance.current?.dispose();
			instance.current = null;
			sync.current = () => {};
		};
	}, []);
	React.useEffect(() => {
		sync.current();
	});
	return <div className="terminal-view terminal" ref={host} />;
}
