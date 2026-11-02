import type {PaletteAction} from '@/renderer/overlay-model';
import type {ProjectInfo} from '@/shared/ipc';

interface ProjectControls {
	projects: readonly ProjectInfo[];
	pending: boolean;
	onOpen(projectId: string): void;
	onLocate(projectId: string): void;
}

export function projectPalette(controls: ProjectControls): PaletteAction[] {
	const busy = controls.pending
		? 'another project request or native dialog is pending'
		: undefined;
	return controls.projects.flatMap(project => [
		{
			id: `project-open-${project.id}`,
			label: `open project ${project.displayName}`,
			glyph: '▸',
			keywords: `recent ${project.canonicalRoot}`,
			disabledReason:
				busy ??
				(project.availability !== 'available'
					? `folder ${project.availability}`
					: undefined),
			run: () => controls.onOpen(project.id),
		},
		{
			id: `project-locate-${project.id}`,
			label: `locate project ${project.displayName}`,
			glyph: '⌗',
			keywords: `moved folder ${project.canonicalRoot}`,
			disabledReason: busy,
			run: () => controls.onLocate(project.id),
		},
	]);
}
