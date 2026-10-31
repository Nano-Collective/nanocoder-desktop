import * as React from 'react';
import {dayAge, shortRoot} from '@/renderer/recency';
import {RuntimeDetails} from '@/renderer/runtime-details';
import {Button, Divider} from '@/renderer/ui';
import type {
	CapabilityGates,
	ConnectedAgent,
	IpcResult,
	NanocoderRuntime,
	ProjectInfo,
} from '@/shared/ipc';

export interface WelcomePageProps {
	logoSrc: string;
	projects: readonly ProjectInfo[];
	busy: boolean;
	connecting: boolean;
	runtime: IpcResult<NanocoderRuntime> | null;
	agent?: ConnectedAgent;
	gates?: CapabilityGates;
	onConnect(): void;
	onOpen(projectId: string): void;
	onLocate(projectId: string): void;
	onCheckRuntime(): void;
}

export function WelcomePage({
	logoSrc,
	projects,
	busy,
	connecting,
	runtime,
	agent,
	gates,
	onConnect,
	onOpen,
	onLocate,
	onCheckRuntime,
}: WelcomePageProps): React.ReactElement {
	const now = new Date();
	return (
		<section className="workspace-welcome" aria-label="get started">
			<img
				className="welcome-logo"
				src={logoSrc}
				alt=""
				width={68}
				height={68}
			/>
			<p className="workspace-eyebrow">local-first workspace / pre-v0.1</p>
			<h2>what are you working on?</h2>
			<p className="welcome-lead">
				open a project folder to start a Nanocoder thread. you’ll review what
				can run before you trust the folder.
			</p>
			{runtime?.ok && (
				<Button className="welcome-open" onClick={onConnect} disabled={busy}>
					<span aria-hidden="true">⌑ </span>
					{connecting ? 'starting Nanocoder' : 'open a project folder'}
				</Button>
			)}
			{projects.length > 0 && (
				<section
					className="welcome-recents"
					aria-label="recent folders on welcome"
				>
					<h3>recent projects</h3>
					<ul className="welcome-recent-list">
						{projects.map(project => {
							const available = project.availability === 'available';
							const age = available ? dayAge(project.lastOpenedAt, now) : null;
							return (
								<li key={project.id}>
									<Button
										className="welcome-recent"
										aria-label={`${available ? 'open' : 'locate'} recent project ${project.displayName}`}
										disabled={busy}
										onClick={() =>
											available ? onOpen(project.id) : onLocate(project.id)
										}
									>
										<span className="welcome-recent-glyph" aria-hidden="true">
											⌑
										</span>
										<span className="welcome-recent-text">
											<span className="welcome-recent-name">
												{project.displayName}
											</span>
											<small title={project.canonicalRoot}>
												{shortRoot(project.canonicalRoot)}
											</small>
										</span>
										<span className="welcome-recent-end" aria-hidden="true">
											{available ? (
												<>
													{age && (
														<span className="welcome-recent-age">{age}</span>
													)}
													<span>↗</span>
												</>
											) : (
												'locate'
											)}
										</span>
									</Button>
								</li>
							);
						})}
					</ul>
				</section>
			)}
			{gates?.versionPolicy.reason && (
				<p className="workspace-setup-warning" role="status">
					{gates.versionPolicy.reason}
				</p>
			)}
			{projects.length > 0 && <Divider />}
			<RuntimeDetails
				runtime={runtime}
				agent={agent}
				gates={gates}
				open={Boolean(runtime && !runtime.ok)}
				onCheckRuntime={onCheckRuntime}
			/>
		</section>
	);
}
