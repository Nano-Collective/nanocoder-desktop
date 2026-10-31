import * as React from 'react';
import {
	ArchivesDialogBody,
	ArchivesDialogFooter,
	type ArchivesDialogProps,
} from '@/renderer/archives-dialog';
import {
	CapabilitiesDialogBody,
	CapabilitiesDialogFooter,
	type CapabilitiesDialogProps,
} from '@/renderer/capabilities-dialog';
import {
	DiagnosticsDialogBody,
	DiagnosticsDialogFooter,
	type DiagnosticsDialogProps,
} from '@/renderer/diagnostics-dialog';
import {DialogShell} from '@/renderer/dialog-shell';
import {
	type WorkspaceDialog,
	workspaceDialogLabels,
} from '@/renderer/overlay-model';
import {
	ProjectsDialogBody,
	ProjectsDialogFooter,
	type ProjectsDialogProps,
} from '@/renderer/projects-dialog';
import {
	RuntimeDialogBody,
	RuntimeDialogFooter,
	type RuntimeDialogProps,
} from '@/renderer/runtime-dialog';

export interface WorkspaceDialogsProps {
	kind: WorkspaceDialog;
	onClose(): void;
	projects: ProjectsDialogProps;
	runtime: RuntimeDialogProps;
	capabilities: CapabilitiesDialogProps;
	archives: ArchivesDialogProps;
	diagnostics: DiagnosticsDialogProps | null;
}

// Renders inside the shared overlay dialog, which owns focus return and Escape.
export function WorkspaceDialogs({
	kind,
	onClose,
	projects,
	runtime,
	capabilities,
	archives,
	diagnostics,
}: WorkspaceDialogsProps): React.ReactElement | null {
	const closeLabel = 'dismiss dialog';
	switch (kind) {
		case 'projects':
			return (
				<DialogShell
					title={workspaceDialogLabels.projects}
					closeLabel={closeLabel}
					onClose={onClose}
					footer={
						<ProjectsDialogFooter
							pending={projects.pending}
							onAdd={projects.onAdd}
						/>
					}
				>
					<ProjectsDialogBody {...projects} />
				</DialogShell>
			);
		case 'runtime':
			return (
				<DialogShell
					title={workspaceDialogLabels.runtime}
					closeLabel={closeLabel}
					onClose={onClose}
					footer={
						<RuntimeDialogFooter
							diagnosticsBusy={runtime.diagnosticsBusy}
							onCapabilities={runtime.onCapabilities}
							onDiagnostics={runtime.onDiagnostics}
							onClose={onClose}
						/>
					}
				>
					<RuntimeDialogBody {...runtime} />
				</DialogShell>
			);
		case 'capabilities':
			return (
				<DialogShell
					title={workspaceDialogLabels.capabilities}
					closeLabel={closeLabel}
					onClose={onClose}
					footer={<CapabilitiesDialogFooter onClose={onClose} />}
				>
					<CapabilitiesDialogBody {...capabilities} />
				</DialogShell>
			);
		case 'archives':
			return (
				<DialogShell
					title={workspaceDialogLabels.archives}
					closeLabel={closeLabel}
					onClose={onClose}
					footer={<ArchivesDialogFooter onClose={onClose} />}
				>
					<ArchivesDialogBody {...archives} />
				</DialogShell>
			);
		case 'diagnostics':
			if (!diagnostics) return null;
			return (
				<DialogShell
					title={workspaceDialogLabels.diagnostics}
					closeLabel={closeLabel}
					onClose={onClose}
					footer={
						<DiagnosticsDialogFooter
							busy={diagnostics.busy}
							onExport={diagnostics.onExport}
							onClose={onClose}
						/>
					}
				>
					<DiagnosticsDialogBody
						snapshot={diagnostics.snapshot}
						message={diagnostics.message}
					/>
				</DialogShell>
			);
		default:
			return null;
	}
}
