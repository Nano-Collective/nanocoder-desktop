import * as React from 'react';
import type {BackgroundItem} from '@/renderer/project-activity';

// Projects other than the one in view that are working, waiting or just done. It is empty
// most of the time, and then it is not there (CHAT-22).
export function BackgroundProjects({
	items,
	pending,
	onOpen,
}: {
	items: readonly BackgroundItem[];
	pending: boolean;
	onOpen(projectId: string): void;
}): React.ReactElement | null {
	if (items.length === 0) return null;
	return (
		<section
			className="sidebar-recents sidebar-background"
			aria-label="projects in the background"
		>
			<h3 className="side-label">
				<span>in the background</span>
				<span className="side-label-count">{items.length}</span>
			</h3>
			<ol className="sidebar-recent-list">
				{items.map(item => (
					<li key={item.projectId}>
						<button
							type="button"
							className={`sidebar-recent background-project background-project--${item.status}`}
							aria-label={`${item.name} · ${item.label} · open`}
							title={`${item.name} · ${item.label}`}
							disabled={pending}
							onClick={() => onOpen(item.projectId)}
						>
							<span className="sidebar-recent-glyph" aria-hidden="true">
								{item.glyph}
							</span>
							<span className="sidebar-recent-name">{item.name}</span>
							<span className="sidebar-recent-age background-project-state">
								{item.label}
							</span>
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}
