import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {ProjectInfo} from '@/shared/ipc';

export const projectsDialogTitle = 'your projects';

export interface ProjectsDialogProps {
	projects: readonly ProjectInfo[];
	activeProjectId: string | null;
	pending: boolean;
	onAdd(): void;
	onOpen(projectId: string): void;
	onLocate(projectId: string): void;
}

export function ProjectsDialogBody({
	projects,
	activeProjectId,
	pending,
	onOpen,
	onLocate,
}: ProjectsDialogProps): React.ReactElement {
	return (
		<>
			{pending && (
				<p role="status">waiting for the project request or native dialog</p>
			)}
			<section aria-label="recent projects">
				{projects.length === 0 ? (
					<p>no recent projects</p>
				) : (
					<ol className="projects-dialog-list">
						{projects.map((project, index) => {
							const selected = project.id === activeProjectId;
							const available = project.availability === 'available';
							const metaId = `projects-dialog-meta-${index}`;
							const body = (
								<>
									<span className="projects-dialog-glyph" aria-hidden="true">
										⌗
									</span>
									<span className="projects-dialog-text">
										<span className="projects-dialog-name">
											{project.displayName}
										</span>
										<span className="projects-dialog-meta" id={metaId}>
											<span
												className="projects-dialog-root"
												title={project.canonicalRoot}
											>
												{project.canonicalRoot}
											</span>
											{selected && (
												<span className="projects-dialog-status">
													{' · selected'}
												</span>
											)}
											{!available && (
												<span className="projects-dialog-status">
													{` · folder ${project.availability}`}
												</span>
											)}
										</span>
									</span>
								</>
							);
							return (
								<li key={project.id} className="projects-dialog-item">
									{available ? (
										<button
											type="button"
											className="projects-dialog-row"
											aria-label={`open ${project.displayName}`}
											aria-current={selected ? 'true' : undefined}
											aria-describedby={metaId}
											disabled={pending}
											onClick={() => onOpen(project.id)}
										>
											{body}
											{selected && (
												<span
													className="projects-dialog-check"
													aria-hidden="true"
												>
													✓
												</span>
											)}
										</button>
									) : (
										<div
											className="projects-dialog-row projects-dialog-row--missing"
											aria-current={selected ? 'true' : undefined}
										>
											{body}
											<Button
												aria-label={`locate ${project.displayName}`}
												aria-describedby={metaId}
												disabled={pending}
												onClick={() => onLocate(project.id)}
											>
												locate…
											</Button>
										</div>
									)}
								</li>
							);
						})}
					</ol>
				)}
			</section>
		</>
	);
}

export function ProjectsDialogFooter({
	pending,
	onAdd,
}: Pick<ProjectsDialogProps, 'pending' | 'onAdd'>): React.ReactElement {
	return (
		<Button onClick={onAdd} disabled={pending}>
			＋ add project folder…
		</Button>
	);
}
