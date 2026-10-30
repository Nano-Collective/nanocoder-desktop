import * as React from 'react';
import {Button} from '@/renderer/ui';

export function AppShell({
	title,
	logoSrc,
	threadTitle,
	projectName,
	statusBadges,
	projectRail,
	threadRail,
	sidebarFooter,
	streamTools,
	composer,
	approvalShelf,
	palette,
	workbench,
	bottomPanel,
	children,
}: {
	title: React.ReactNode;
	logoSrc?: string;
	threadTitle?: React.ReactNode;
	projectName?: string;
	statusBadges: React.ReactNode;
	projectRail?: React.ReactNode;
	threadRail?: React.ReactNode;
	sidebarFooter?: React.ReactNode;
	streamTools?: React.ReactNode;
	composer?: React.ReactNode;
	approvalShelf?: React.ReactNode;
	palette?: React.ReactNode;
	workbench?: {title: string; children: React.ReactNode; onClose(): void};
	bottomPanel?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="app-shell">
			<aside className="shell-project-rail" aria-label="project rail">
				<h1 className="shell-brand">
					{logoSrc && <img className="official-logo" src={logoSrc} alt="" />}
					{title}
				</h1>
				<div data-shell-slot="project-rail">{projectRail}</div>
				<div data-shell-slot="thread-rail">{threadRail}</div>
				{sidebarFooter && (
					<footer className="shell-sidebar-footer">{sidebarFooter}</footer>
				)}
			</aside>
			<div className="shell-main-area">
				<header className="shell-title-bar">
					<div className="shell-identity">
						{projectName && <p className="shell-breadcrumb">{projectName}</p>}
						<h2>{threadTitle ?? 'your workspace'}</h2>
					</div>
					<div className="gate-actions">{statusBadges}</div>
					{palette}
				</header>
				<div className="shell-canvas" data-workbench-open={Boolean(workbench)}>
					<main className="shell-stream" aria-label="conversation workspace">
						<div className="shell-stream-scroll">
							{streamTools && (
								<div
									className="shell-stream-tools"
									data-shell-slot="stream-tools"
								>
									{streamTools}
								</div>
							)}
							<div className="technical-gate">{children}</div>
						</div>
						<div className="shell-conversation-footer">
							{approvalShelf && (
								<div
									className="shell-approval-shelf"
									aria-label="approval shelf"
								>
									{approvalShelf}
								</div>
							)}
							{composer && <div className="shell-composer">{composer}</div>}
						</div>
					</main>
					{workbench && (
						<aside
							className="shell-workbench"
							aria-label={workbench.title}
							data-shell-slot="workbench"
						>
							<header className="shell-workbench-header">
								<h2>{workbench.title}</h2>
								<Button onClick={workbench.onClose}>
									<span className="workbench-close-wide">close panel</span>
									<span className="workbench-close-narrow">← back to chat</span>
								</Button>
							</header>
							{workbench.children}
						</aside>
					)}
				</div>
				{bottomPanel && (
					<section
						className="shell-bottom-panel"
						aria-label="project tools"
						data-shell-slot="bottom-panel"
					>
						{bottomPanel}
					</section>
				)}
			</div>
		</div>
	);
}
