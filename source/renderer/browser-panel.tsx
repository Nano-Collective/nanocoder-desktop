import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {
	BrowserBounds,
	BrowserNavigation,
	BrowserSnapshot,
} from '@/shared/browser';

export interface BrowserPanelProps {
	projectName: string;
	snapshot: BrowserSnapshot | null;
	publicSites: boolean;
	loading: boolean;
	pending: boolean;
	error: string | null;
	suspended: boolean;
	onOpen(input: string): Promise<boolean>;
	onNavigate(action: BrowserNavigation): void;
	onBounds(bounds: BrowserBounds | null): void;
	onPublicSites(enabled: boolean): void;
	onAllowAndOpen(url: string): void;
}

const SECURITY = {
	local: {glyph: '●', word: 'local', tone: 'ok'},
	secure: {glyph: '●', word: 'secure', tone: 'ok'},
	insecure: {glyph: '▲', word: 'not secure', tone: 'warn'},
} as const;

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return 'that address';
	}
}

function useViewportBounds(
	node: React.RefObject<HTMLDivElement | null>,
	active: boolean,
	onBounds: (bounds: BrowserBounds | null) => void,
): void {
	React.useEffect(() => {
		const element = node.current;
		if (!element || !active) {
			onBounds(null);
			return;
		}
		let frame = 0;
		const report = () => {
			frame = 0;
			const rect = element.getBoundingClientRect();
			onBounds(
				rect.width >= 1 && rect.height >= 1
					? {
							x: Math.max(0, Math.round(rect.left)),
							y: Math.max(0, Math.round(rect.top)),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						}
					: null,
			);
		};
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(report);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(element);
		observer.observe(document.body);
		window.addEventListener('resize', schedule);
		schedule();
		return () => {
			if (frame !== 0) cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', schedule);
			onBounds(null);
		};
	}, [node, active, onBounds]);
}

export function BrowserPanel({
	projectName,
	snapshot,
	publicSites,
	loading,
	pending,
	error,
	suspended,
	onOpen,
	onNavigate,
	onBounds,
	onPublicSites,
	onAllowAndOpen,
}: BrowserPanelProps): React.ReactElement {
	const viewport = React.useRef<HTMLDivElement>(null);
	const address = React.useRef<HTMLInputElement>(null);
	const [draft, setDraft] = React.useState<string | null>(null);
	const [dismissed, setDismissed] = React.useState<string | null>(null);
	useViewportBounds(viewport, !suspended, onBounds);
	const shownUrl = snapshot?.url ?? null;
	React.useEffect(() => {
		if (shownUrl !== undefined && document.activeElement !== address.current)
			setDraft(null);
	}, [shownUrl]);
	const open = snapshot !== null && snapshot.status !== 'closed';
	const busy = snapshot?.status === 'loading';
	const blocked =
		snapshot?.blocked && snapshot.blocked.url !== dismissed
			? snapshot.blocked
			: null;
	const security = snapshot?.security ? SECURITY[snapshot.security] : null;
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		const input = draft ?? snapshot?.url ?? '';
		if (await onOpen(input)) setDraft(null);
	};
	return (
		<div className="browser-panel">
			<form
				className="browser-toolbar"
				onSubmit={event => void submit(event)}
				aria-label={`browser for ${projectName}`}
			>
				<Button
					aria-label="back"
					title="back"
					disabled={!snapshot?.canGoBack}
					onClick={() => onNavigate('back')}
				>
					←
				</Button>
				<Button
					aria-label="forward"
					title="forward"
					disabled={!snapshot?.canGoForward}
					onClick={() => onNavigate('forward')}
				>
					→
				</Button>
				<Button
					aria-label={busy ? 'stop loading' : 'reload'}
					title={busy ? 'stop loading' : 'reload'}
					disabled={!open}
					onClick={() => onNavigate(busy ? 'stop' : 'reload')}
				>
					{busy ? '✕' : '↻'}
				</Button>
				<input
					className="browser-address"
					type="text"
					aria-label="address"
					placeholder="localhost:5173"
					spellCheck={false}
					autoComplete="off"
					ref={address}
					value={draft ?? snapshot?.url ?? ''}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Escape') setDraft(null);
					}}
					disabled={loading}
				/>
				<Button type="submit" disabled={pending || loading}>
					go
				</Button>
			</form>
			<div className="browser-meta">
				<span className="browser-origin" role="status">
					{security && snapshot?.origin ? (
						<>
							<span
								className={`browser-security browser-security--${security.tone}`}
							>
								<span aria-hidden="true">{security.glyph}</span> {security.word}
							</span>{' '}
							<span>{snapshot.origin}</span>
						</>
					) : (
						'no page open'
					)}
					{busy && ' · loading…'}
				</span>
				<label className="browser-public">
					<input
						type="checkbox"
						checked={publicSites}
						onChange={event => onPublicSites(event.target.checked)}
					/>{' '}
					allow public sites
				</label>
			</div>
			{blocked && (
				<div className="browser-notice" role="alert">
					{blocked.reason === 'public-off' ? (
						<>
							<p>
								{hostOf(blocked.url)} is a public site, and public sites are
								off. only localhost pages open.
							</p>
							<div className="browser-notice-actions">
								<Button onClick={() => onAllowAndOpen(blocked.url)}>
									turn on public sites and open it
								</Button>
								<Button onClick={() => setDismissed(blocked.url)}>
									stay on localhost
								</Button>
							</div>
						</>
					) : (
						<>
							<p>only http and https pages open here.</p>
							<div className="browser-notice-actions">
								<Button onClick={() => setDismissed(blocked.url)}>
									dismiss
								</Button>
							</div>
						</>
					)}
				</div>
			)}
			{!snapshot?.blocked && error && (
				<p className="browser-notice" role="alert">
					{error}
				</p>
			)}
			{!snapshot?.blocked && !error && snapshot?.status === 'failed' && (
				<p className="browser-notice" role="alert">
					{snapshot.reason ?? 'the page could not load'}
				</p>
			)}
			<div
				ref={viewport}
				className="browser-viewport"
				role="region"
				aria-label="web page"
			>
				{!open && (
					<p className="browser-empty">
						enter an address to preview a page. localhost opens by default.
					</p>
				)}
			</div>
		</div>
	);
}
