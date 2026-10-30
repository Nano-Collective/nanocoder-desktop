import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import {
	filterActions,
	focusReturn,
	moveSelection,
	type PaletteAction,
	runAction,
	type Toast,
	toastQueue,
} from '@/renderer/overlay-model';
import {Button} from '@/renderer/ui';

type Overlay = 'palette' | 'shortcuts';
const OverlayContext = createContext<{
	open(kind: Overlay): void;
	shortcut: string;
} | null>(null);

export function PaletteButton() {
	const overlays = useContext(OverlayContext);
	if (!overlays) return null;
	return (
		<Button
			aria-label="command palette"
			aria-haspopup="dialog"
			onClick={() => overlays.open('palette')}
		>
			<kbd>{overlays.shortcut}</kbd> palette
		</Button>
	);
}

function Notifications({
	active,
	toast,
	error,
	pendingApprovalCount = 0,
}: {
	active: boolean;
	toast: Toast | null;
	error: string;
	pendingApprovalCount?: number;
}) {
	return (
		<div
			className="toast-region"
			role="status"
			aria-label="notification"
			aria-live={active ? 'polite' : 'off'}
			aria-hidden={!active}
			aria-atomic="true"
		>
			<span className="overlay-approval-announcement">
				{active && pendingApprovalCount > 0
					? `approval required · ${pendingApprovalCount} waiting`
					: ''}
			</span>
			{active && error && <p className="overlay-error">{error}</p>}
			{active && toast && (
				<div
					key={toast.id}
					className="overlay-toast"
					data-exiting={toast.exiting}
				>
					<span aria-hidden="true">✓</span> {toast.message}
				</div>
			)}
		</div>
	);
}

export function OverlayProvider({
	actions,
	pendingApprovalCount = 0,
	children,
}: {
	actions: PaletteAction[];
	pendingApprovalCount?: number;
	children: ReactNode;
}) {
	const [kind, setKind] = useState<Overlay | null>(null);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState(0);
	const [toast, setToast] = useState<Toast | null>(null);
	const [themeError, setThemeError] = useState('');
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const returnFocus = useRef<(() => void) | null>(null);
	const closingFocus = useRef<Element | null>(null);
	const notifications = useRef<ReturnType<typeof toastQueue> | null>(null);
	const themeChanged = useRef(false);
	const mac = navigator.platform.startsWith('Mac');
	const shortcut = mac ? '⌘K' : 'Ctrl+K';
	const opened = kind !== null;

	useEffect(() => {
		const queue = toastQueue(
			{
				schedule(callback, delay) {
					const timer = window.setTimeout(callback, delay);
					return () => window.clearTimeout(timer);
				},
			},
			setToast,
		);
		notifications.current = queue;
		return () => queue.dispose();
	}, []);

	useEffect(() => {
		let current = true;
		void window.desktop.getSettings({}).then(result => {
			if (!current || themeChanged.current || !result.ok) return;
			const theme = result.value.theme;
			document.documentElement.dataset.theme =
				theme === 'system'
					? window.matchMedia('(prefers-color-scheme: light)').matches
						? 'light'
						: 'dark'
					: theme;
		});
		return () => {
			current = false;
		};
	}, []);

	const open = useCallback((next: Overlay) => {
		if (!dialog.current?.open) {
			const target = document.activeElement;
			returnFocus.current = focusReturn(
				target instanceof HTMLElement ? target : null,
				document.querySelector<HTMLButtonElement>(
					'[aria-label="command palette"]',
				) ?? document.body,
			);
		}
		setQuery('');
		setSelected(0);
		setKind(next);
	}, []);

	const close = useCallback(() => {
		dialog.current?.close();
		const active = document.activeElement;
		closingFocus.current = active;
		// Do not expose native-restored editor focus before close has settled.
		if (
			active instanceof HTMLTextAreaElement ||
			(active instanceof HTMLInputElement && active.selectionStart !== null) ||
			(active instanceof HTMLElement && active.isContentEditable)
		)
			active.blur();
		setKind(null);
	}, []);

	useLayoutEffect(() => {
		if (opened) dialog.current?.showModal();
	}, [opened]);

	useLayoutEffect(() => {
		if (kind === 'palette') input.current?.focus();
		else if (kind === 'shortcuts')
			dialog.current?.querySelector('button')?.focus();
	}, [kind]);

	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
				return;
			if (event.key === 'Escape' && dialog.current?.open) {
				event.preventDefault();
				close();
				return;
			}
			const target = event.target;
			const typing =
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					!!target.closest('input, textarea, select, [role="textbox"]'));
			if (
				event.key.toLowerCase() === 'k' &&
				(mac ? event.metaKey : event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				open('palette');
			} else if (
				event.key === '?' &&
				!typing &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault();
				open('shortcuts');
			}
		};
		document.addEventListener('keydown', keydown);
		return () => document.removeEventListener('keydown', keydown);
	}, [close, mac, open]);

	const changeTheme = async (theme: 'dark' | 'light') => {
		themeChanged.current = true;
		setThemeError('');
		const result = await window.desktop.updateSettings({patch: {theme}});
		if (!result.ok) {
			setThemeError('theme could not be saved. try again.');
			return;
		}
		document.documentElement.dataset.theme = theme;
		notifications.current?.push(`switched to ${theme} theme`);
	};
	const commands: PaletteAction[] = [
		...actions,
		...(['dark', 'light'] as const).map(theme => ({
			id: `theme-${theme}`,
			label: `switch to ${theme} theme`,
			glyph: '◐',
			keywords: 'appearance colour',
			run: () => {
				void changeTheme(theme);
			},
		})),
		{
			id: 'shortcuts',
			label: 'keyboard shortcuts',
			glyph: '?',
			shortcut: '?',
			run: () => open('shortcuts'),
		},
	];
	const filtered = filterActions(commands, query);
	const index = moveSelection(selected, 0, filtered.length);
	const selectedId = filtered[index]?.id;
	useLayoutEffect(() => {
		if (kind === 'palette' && selectedId)
			document
				.getElementById(`palette-option-${selectedId}`)
				?.scrollIntoView({block: 'nearest'});
	}, [kind, selectedId]);
	const execute = (action: PaletteAction | undefined) => {
		if (!action || action.disabledReason) return;
		if (action.id !== 'shortcuts') close();
		runAction(action);
	};

	return (
		<OverlayContext value={{open, shortcut}}>
			{children}
			<dialog
				ref={dialog}
				className="overlay-dialog"
				aria-label={
					kind === 'shortcuts' ? 'keyboard shortcuts' : 'command palette'
				}
				onClose={() => {
					if (dialog.current?.open) return;
					const restore = returnFocus.current;
					returnFocus.current = null;
					const active = document.activeElement;
					if (
						active !== document.body &&
						active !== closingFocus.current &&
						!dialog.current?.contains(active)
					)
						return;
					restore?.();
				}}
				onCancel={event => {
					event.preventDefault();
					close();
				}}
				onClick={event => {
					if (event.target === dialog.current) close();
				}}
				onKeyDown={event => {
					if (
						event.nativeEvent.isComposing ||
						event.nativeEvent.keyCode === 229
					)
						return;
					if (event.key === 'Escape') {
						event.preventDefault();
						close();
					}
				}}
			>
				<div className="overlay-content">
					<div className="overlay-heading">
						<h2>
							{kind === 'shortcuts' ? 'keyboard shortcuts' : 'command palette'}
						</h2>
						<Button
							aria-label={`close ${kind === 'shortcuts' ? 'keyboard shortcuts' : 'command palette'}`}
							onClick={close}
						>
							<span aria-hidden="true">✕</span> close <kbd>Esc</kbd>
						</Button>
					</div>
					{kind === 'palette' ? (
						<>
							<label className="overlay-search">
								find a command
								<input
									ref={input}
									role="combobox"
									aria-expanded="true"
									aria-autocomplete="list"
									aria-controls="palette-results"
									aria-activedescendant={
										filtered[index]
											? `palette-option-${filtered[index].id}`
											: undefined
									}
									value={query}
									placeholder="type a command…"
									onChange={event => {
										setQuery(event.target.value);
										setSelected(0);
									}}
									onKeyDown={event => {
										if (
											event.nativeEvent.isComposing ||
											event.nativeEvent.keyCode === 229
										)
											return;
										if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
											event.preventDefault();
											setSelected(
												moveSelection(
													index,
													event.key === 'ArrowDown' ? 1 : -1,
													filtered.length,
												),
											);
										} else if (event.key === 'Enter') {
											event.preventDefault();
											execute(filtered[index]);
										}
									}}
								/>
							</label>
							<div
								id="palette-results"
								role="listbox"
								aria-label="commands"
								className="palette-results"
							>
								{filtered.map((action, position) => (
									<div
										key={action.id}
										id={`palette-option-${action.id}`}
										role="option"
										tabIndex={-1}
										aria-selected={position === index}
										aria-disabled={!!action.disabledReason}
										className="palette-option"
										onMouseDown={event => event.preventDefault()}
										onClick={() => execute(action)}
										onKeyDown={event => {
											if (event.key === 'Enter') execute(action);
										}}
									>
										<span aria-hidden="true">{action.glyph}</span>
										<span>
											{action.label}
											{action.description && (
												<span className="palette-description">
													{action.description}
												</span>
											)}
											{action.disabledReason && (
												<span className="palette-reason">
													unavailable: {action.disabledReason}
												</span>
											)}
										</span>
										{action.shortcut && <kbd>{action.shortcut}</kbd>}
									</div>
								))}
							</div>
							{!filtered.length && (
								<p className="overlay-empty" role="status">
									no matching commands
								</p>
							)}
							<p className="overlay-hint">↑ ↓ choose · Enter run · Esc close</p>
						</>
					) : (
						<dl className="shortcut-list">
							<div>
								<dt>command palette</dt>
								<dd>
									<kbd>{shortcut}</kbd>
								</dd>
							</div>
							<div>
								<dt>keyboard shortcuts (outside text fields)</dt>
								<dd>
									<kbd>?</kbd>
								</dd>
							</div>
							<div>
								<dt>choose a command</dt>
								<dd>
									<kbd>↑ ↓</kbd>
								</dd>
							</div>
							<div>
								<dt>run selected command</dt>
								<dd>
									<kbd>Enter</kbd>
								</dd>
							</div>
							<div>
								<dt>close overlay</dt>
								<dd>
									<kbd>Esc</kbd>
								</dd>
							</div>
							<div>
								<dt>next / previous control</dt>
								<dd>
									<kbd>Tab / Shift+Tab</kbd>
								</dd>
							</div>
						</dl>
					)}
				</div>
				<Notifications
					active={opened}
					toast={toast}
					error={themeError}
					pendingApprovalCount={pendingApprovalCount}
				/>
			</dialog>
			<Notifications active={!opened} toast={toast} error={themeError} />
		</OverlayContext>
	);
}
