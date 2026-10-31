import * as React from 'react';
import {
	ArchivesDialogBody,
	ArchivesDialogFooter,
	type ArchivesDialogProps,
	archivesDialogTitle,
} from '@/renderer/archives-dialog';
import {
	CapabilitiesDialogBody,
	CapabilitiesDialogFooter,
	type CapabilitiesDialogProps,
	capabilitiesDialogTitle,
} from '@/renderer/capabilities-dialog';
import {
	DiagnosticsDialogBody,
	DiagnosticsDialogFooter,
	type DiagnosticsDialogProps,
	diagnosticsDialogTitle,
} from '@/renderer/diagnostics-dialog';
import {DialogFrame} from '@/renderer/dialog-frame';
import {
	ProjectsDialogBody,
	ProjectsDialogFooter,
	type ProjectsDialogProps,
	projectsDialogTitle,
} from '@/renderer/projects-dialog';
import {
	RuntimeDialogBody,
	RuntimeDialogFooter,
	type RuntimeDialogProps,
	runtimeDialogTitle,
} from '@/renderer/runtime-dialog';

export type WorkspaceDialogKind =
	| 'projects'
	| 'runtime'
	| 'capabilities'
	| 'archives'
	| 'diagnostics';

export interface WorkspaceDialogsProps {
	kind: WorkspaceDialogKind | null;
	onClose(): void;
	projects: ProjectsDialogProps;
	runtime: RuntimeDialogProps;
	capabilities: CapabilitiesDialogProps;
	archives: ArchivesDialogProps;
	diagnostics: DiagnosticsDialogProps | null;
}

// One frame per open dialog; the key remounts it when one replaces another.
export function WorkspaceDialogs({
	kind,
	onClose,
	projects,
	runtime,
	capabilities,
	archives,
	diagnostics,
}: WorkspaceDialogsProps): React.ReactElement | null {
	switch (kind) {
		case 'projects':
			return (
				<DialogFrame
					key={kind}
					title={projectsDialogTitle}
					onClose={onClose}
					footer={
						<ProjectsDialogFooter
							pending={projects.pending}
							onAdd={projects.onAdd}
						/>
					}
				>
					<ProjectsDialogBody {...projects} />
				</DialogFrame>
			);
		case 'runtime':
			return (
				<DialogFrame
					key={kind}
					title={runtimeDialogTitle}
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
				</DialogFrame>
			);
		case 'capabilities':
			return (
				<DialogFrame
					key={kind}
					title={capabilitiesDialogTitle}
					onClose={onClose}
					footer={<CapabilitiesDialogFooter onClose={onClose} />}
				>
					<CapabilitiesDialogBody {...capabilities} />
				</DialogFrame>
			);
		case 'archives':
			return (
				<DialogFrame
					key={kind}
					title={archivesDialogTitle}
					onClose={onClose}
					footer={<ArchivesDialogFooter onClose={onClose} />}
				>
					<ArchivesDialogBody {...archives} />
				</DialogFrame>
			);
		case 'diagnostics':
			if (!diagnostics) return null;
			return (
				<DialogFrame
					key={kind}
					title={diagnosticsDialogTitle}
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
				</DialogFrame>
			);
		default:
			return null;
	}
}
