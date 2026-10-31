import type {PaletteAction} from '@/renderer/overlay-model';
import type {ProjectInfo} from '@/shared/ipc';

interface ProjectControls {
	projects: readonly ProjectInfo[];
	pending: boolean;
	onAdd(): void;
	onOpen(projectId: string): void;
	onLocate(projectId: string): void;
}

export function projectPalette(controls: ProjectControls): PaletteAction[] {
	const busy = controls.pending
		? 'another project request or native dialog is pending'
		: undefined;
	return [
		{
			id: 'project-add',
			label: 'add project folder',
			glyph: '⌗',
			keywords: 'new directory',
			disabledReason: busy,
			run: controls.onAdd,
		},
		...controls.projects.flatMap(project => [
			{
				id: `project-open-${project.id}`,
				label: `open project ${project.displayName}`,
				glyph: '▸',
				keywords: `recent ${project.canonicalRoot}`,
				description: project.canonicalRoot,
				disabledReason:
					busy ??
					(project.availability !== 'available'
						? `folder ${project.availability}; locate it before opening`
						: undefined),
				run: () => controls.onOpen(project.id),
			},
			{
				id: `project-locate-${project.id}`,
				label: `locate project ${project.displayName}`,
				glyph: '⌗',
				keywords: `moved folder ${project.canonicalRoot}`,
				description: project.canonicalRoot,
				disabledReason: busy,
				run: () => controls.onLocate(project.id),
			},
		]),
	];
}
