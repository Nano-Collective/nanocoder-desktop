import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {DiscoveredSession} from '@/shared/ipc';

export interface SessionImportListProps {
	projectId: string | null;
	active: boolean;
	sessions: readonly DiscoveredSession[];
	loading: boolean;
	importing: string | null;
	error: string | null;
	disabledReason?: string;
	onRefresh(): Promise<boolean>;
	onImport(sessionId: string): Promise<boolean>;
}

export function SessionImportList(
	props: SessionImportListProps,
): React.ReactElement | null {
	const region = React.useRef<HTMLElement>(null);
	const refresh = React.useRef<HTMLButtonElement>(null);
	const returnFocus = React.useRef<{projectId: string | null} | null>(null);
	const reasonId = React.useId();
	const reason = props.loading
		? 'loading saved session metadata'
		: props.importing !== null
			? 'waiting for the metadata import'
			: props.disabledReason;
	React.useLayoutEffect(() => {
		const pending = returnFocus.current;
		if (!pending) return;
		if (pending.projectId !== props.projectId) {
			returnFocus.current = null;
			return;
		}
		if (props.importing !== null) return;
		returnFocus.current = null;
		const active = document.activeElement;
		if (active === document.body || region.current?.contains(active)) {
			refresh.current?.focus();
		}
	});
	if (!props.active) return null;
	return (
		<section
			ref={region}
			className="session-imports"
			aria-label="import saved sessions"
		>
			<h2 className="thread-group-heading">saved sessions</h2>
			<Button
				ref={refresh}
				aria-label="refresh saved sessions"
				aria-describedby={reason ? reasonId : undefined}
				disabled={Boolean(reason)}
				onClick={() => {
					void props.onRefresh();
				}}
			>
				refresh
			</Button>
			<p className="thread-rail-note">
				import adds a desktop thread only; open it to resume
			</p>
			{reason && (
				<p id={reasonId} role="status" className="thread-rail-note">
					{reason}
				</p>
			)}
			{props.error && (
				<p role="alert" className="thread-rail-note">
					{props.error}
				</p>
			)}
			{!props.loading && props.sessions.length === 0 && (
				<p className="thread-rail-note">
					no sessions offered for import; this is a best-effort list
				</p>
			)}
			<ul className="thread-list">
				{props.sessions.map(session => (
					<li key={session.id} className="session-import">
						<span className="session-import-title">{session.title}</span>
						<span className="thread-rail-note">
							{session.lastActivityAt ? (
								<time dateTime={session.lastActivityAt}>
									last active{' '}
									{new Date(session.lastActivityAt).toLocaleString()}
								</time>
							) : (
								'last active unavailable'
							)}
						</span>
						<Button
							aria-label={`import saved session: ${session.title}`}
							aria-describedby={reason ? reasonId : undefined}
							disabled={Boolean(reason)}
							onClick={() => {
								returnFocus.current = {projectId: props.projectId};
								void props.onImport(session.id);
							}}
						>
							import
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}
