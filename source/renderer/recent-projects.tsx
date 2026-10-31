import * as React from 'react';
import {Button, Divider} from '@/renderer/ui';
import type {ProjectInfo} from '@/shared/ipc';

interface RecentProjectsProps {
	compact?: boolean;
	projects: readonly ProjectInfo[];
	activeProjectId: string | null;
	pending: boolean;
	onAdd(): void;
	onOpen(projectId: string): void;
	onLocate(projectId: string): void;
}

export function RecentProjects({
	compact = false,
	projects,
	activeProjectId,
	pending,
	onAdd,
	onOpen,
	onLocate,
}: RecentProjectsProps): React.ReactElement {
	const switcher = React.useRef<HTMLDetailsElement>(null);
	const selected = projects.find(project => project.id === activeProjectId);
	const list = (
		<section className="recent-projects" aria-label="recent projects">
			<header className="recent-projects-heading">
				<h2>recent projects</h2>
				<Button onClick={onAdd} disabled={pending}>
					add project folder
				</Button>
			</header>
			{pending && (
				<p className="recent-project-meta" role="status">
					waiting for the project request or native dialog
				</p>
			)}
			{projects.length === 0 && (
				<p className="recent-project-meta">no recent projects</p>
			)}
			<ol className="recent-project-list">
				{projects.map(project => (
					<li
						key={project.id}
						className={`recent-project${activeProjectId === project.id ? ' recent-project--active' : ''}`}
						aria-current={activeProjectId === project.id ? 'true' : undefined}
					>
						<div className="recent-project-description">
							<p>{project.displayName}</p>
							<p className="recent-project-meta recent-project-path">
								{project.canonicalRoot}
							</p>
							<p className="recent-project-meta">
								{project.availability !== 'available'
									? `folder ${project.availability}; locate it before opening`
									: project.trusted
										? 'trust recorded; checked again when opening'
										: 'trust required before starting a session'}
							</p>
						</div>
						<div className="recent-project-actions">
							<Button
								aria-label={`open ${project.displayName}`}
								onClick={() => onOpen(project.id)}
								disabled={pending || project.availability !== 'available'}
							>
								open
							</Button>
							<Button
								aria-label={`locate ${project.displayName}`}
								onClick={() => onLocate(project.id)}
								disabled={pending}
							>
								locate
							</Button>
						</div>
						<Divider soft />
					</li>
				))}
			</ol>
		</section>
	);
	if (!compact) return list;
	return (
		<details
			ref={switcher}
			className="project-switcher"
			open={!selected || undefined}
		>
			<summary aria-label="switch project">
				<span className="project-initial" aria-hidden="true">
					{selected?.displayName.slice(0, 1) ?? '⌗'}
				</span>
				<span className="project-switch-label">
					<span>{selected?.displayName ?? 'choose a project'}</span>
					<span className="project-switch-root">
						{selected?.canonicalRoot ?? 'open a local folder'}
					</span>
				</span>
				<span aria-hidden="true">▾</span>
			</summary>
			<div
				className="project-switcher-menu"
				onClick={event => {
					if (
						(event.target as Element).closest('button') &&
						selected &&
						switcher.current
					)
						switcher.current.open = false;
				}}
			>
				{list}
			</div>
		</details>
	);
}
