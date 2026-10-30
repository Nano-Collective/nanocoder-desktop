import * as React from 'react';

export function AppShell({
	title,
	statusBadges,
	projectRail,
	threadRail,
	streamTools,
	composer,
	palette,
	children,
}: {
	title: React.ReactNode;
	statusBadges: React.ReactNode;
	projectRail?: React.ReactNode;
	threadRail?: React.ReactNode;
	streamTools?: React.ReactNode;
	composer?: React.ReactNode;
	palette?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="app-shell">
			<header className="shell-title-bar">
				<h1>{title}</h1>
				<div
					className="shell-session-tabs"
					role="group"
					aria-label="session tabs"
				>
					<span className="shell-placeholder">
						session tabs · not built yet
					</span>
				</div>
				<div className="gate-actions">{statusBadges}</div>
				{palette ?? (
					<span className="shell-placeholder shell-palette">
						<kbd>⌘K</kbd> palette not built yet
					</span>
				)}
			</header>
			<div className="shell-columns">
				<aside className="shell-project-rail" aria-label="project rail">
					<h2 className="shell-heading">projects</h2>
					<div data-shell-slot="project-rail">
						{projectRail ?? (
							<p className="shell-placeholder">project list not built yet</p>
						)}
					</div>
					<div data-shell-slot="thread-rail">
						{threadRail ?? (
							<p className="shell-placeholder">thread list not built yet</p>
						)}
					</div>
				</aside>
				<main className="shell-stream" aria-label="conversation workspace">
					<div className="shell-stream-scroll">
						<div className="shell-stream-tools" data-shell-slot="stream-tools">
							{streamTools}
						</div>
						<div className="technical-gate">{children}</div>
					</div>
					{composer && <div className="shell-composer">{composer}</div>}
				</main>
				<aside className="shell-inspector" aria-label="inspector">
					<div
						className="shell-inspector-tabs"
						role="group"
						aria-label="inspector tabs not built yet"
					>
						<span className="shell-placeholder">files</span>
						<span className="shell-placeholder">review</span>
					</div>
					<p className="shell-placeholder">
						files and review are not built yet
					</p>
				</aside>
			</div>
		</div>
	);
}
