import * as React from 'react';
import type {ProjectInfo} from '@/shared/ipc';

export function ProjectSwitch({
	selected,
	onOpen,
}: {
	selected: ProjectInfo | undefined;
	onOpen(): void;
}): React.ReactElement {
	return (
		<button
			type="button"
			className="project-switch"
			aria-label="switch project"
			aria-haspopup="dialog"
			onClick={onOpen}
		>
			<span className="project-initial" aria-hidden="true">
				{selected?.displayName.slice(0, 1) ?? '⌗'}
			</span>
			<span className="project-switch-text">
				<span className="project-switch-name">
					{selected?.displayName ?? 'choose a project'}
				</span>
				<span className="project-switch-root">
					{selected?.canonicalRoot ?? 'open a local folder'}
				</span>
			</span>
			<span className="project-switch-chevron" aria-hidden="true">
				▾
			</span>
		</button>
	);
}
