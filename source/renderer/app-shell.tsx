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
	onOpenThreadMenu,
	streamTools,
	composer,
	composerPlacement = 'bottom',
	approvalShelf,
	palette,
	workbench,
	bottomPanel,
	children,
}: {
	title: React.ReactNode;
	logoSrc?: string;
	// Undefined on the welcome page, which shows the local workspace eyebrow.
	threadTitle?: string;
	projectName?: string;
	// Header turn status slot.
	statusBadges?: React.ReactNode;
	projectRail?: React.ReactNode;
	threadRail?: React.ReactNode;
	// Sidebar footer slot. Its rows are styled by the sidebar.
	sidebarFooter?: React.ReactNode;
	// Shows the thread actions button after the title when set.
	onOpenThreadMenu?: () => void;
	streamTools?: React.ReactNode;
	composer?: React.ReactNode;
	composerPlacement?: 'centred' | 'bottom';
	approvalShelf?: React.ReactNode;
	palette?: React.ReactNode;
	workbench?: {title: string; children: React.ReactNode; onClose(): void};
	bottomPanel?: React.ReactNode;
	children: React.ReactNode;
}) {
	const inThread = threadTitle !== undefined;
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
						<p className="shell-breadcrumb">
							{inThread
								? `${projectName ?? 'selected project'} / conversation`
								: 'local workspace'}
						</p>
						<div className="shell-title-row">
							<h2>{inThread ? threadTitle : 'your projects'}</h2>
							{inThread && onOpenThreadMenu && (
								<button
									type="button"
									className="shell-menu-button"
									aria-label="thread actions"
									aria-haspopup="dialog"
									onClick={onOpenThreadMenu}
								>
									<span aria-hidden="true">•••</span>
								</button>
							)}
						</div>
					</div>
					<div className="shell-header-actions">
						{statusBadges}
						{palette}
					</div>
				</header>
				<div className="shell-canvas" data-workbench-open={Boolean(workbench)}>
					<main
						className="shell-stream"
						aria-label="conversation workspace"
						data-composer-placement={composerPlacement}
					>
						<div
							className="shell-stream-scroll"
							role="region"
							aria-label="conversation"
							tabIndex={0}
						>
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
