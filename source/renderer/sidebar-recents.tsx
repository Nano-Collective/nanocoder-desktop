import * as React from 'react';
import {compactAge} from '@/renderer/thread-rail-model';
import type {ProjectInfo} from '@/shared/ipc';

interface SidebarRecentsProps {
	projects: readonly ProjectInfo[];
	pending: boolean;
	now: Date;
	onOpen(projectId: string): void;
	onLocate(projectId: string): void;
}

export function SidebarRecents({
	projects,
	pending,
	now,
	onOpen,
	onLocate,
}: SidebarRecentsProps): React.ReactElement | null {
	if (projects.length === 0) return null;
	return (
		<section className="sidebar-recents" aria-label="recent folders in sidebar">
			<h3 className="side-label">
				<span>recent projects</span>
				<span className="side-label-count">{projects.length}</span>
			</h3>
			<ol className="sidebar-recent-list">
				{projects.map(project => {
					const action =
						project.availability === 'available' ? 'open' : 'locate';
					return (
						<li key={project.id}>
							<button
								type="button"
								className="sidebar-recent"
								aria-label={`${project.displayName} · ${action}`}
								title={`${project.canonicalRoot} · ${action}`}
								disabled={pending}
								onClick={() =>
									action === 'open' ? onOpen(project.id) : onLocate(project.id)
								}
							>
								<span className="sidebar-recent-glyph" aria-hidden="true">
									○
								</span>
								<span className="sidebar-recent-name">
									{project.displayName}
								</span>
								<time
									className="sidebar-recent-age"
									dateTime={project.lastOpenedAt}
								>
									{compactAge(project.lastOpenedAt, now)}
								</time>
							</button>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
