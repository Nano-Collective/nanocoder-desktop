import type {NanocoderSupervisor} from '@/main/nanocoder/supervisor-contracts';
import type {DesktopStore} from '@/main/store/contracts';
import type {
	SupervisorState,
	WorkspaceRequests,
	WorkspaceValues,
} from '@/shared/ipc';

type ServiceMethods<K extends keyof WorkspaceRequests> = {
	[M in K]: (
		request: WorkspaceRequests[M],
	) => WorkspaceValues[M] | Promise<WorkspaceValues[M]>;
};

// Picker, trust and deletion confirmations stay in main, never in request payloads.
export type ProjectService = ServiceMethods<
	| 'addProject'
	| 'openProject'
	| 'locateProject'
	| 'removeProject'
	| 'setProjectDefaultMode'
>;

export type ThreadService = ServiceMethods<
	| 'listThreads'
	| 'createThread'
	| 'openThread'
	| 'getThreadSnapshot'
	| 'renameThread'
	| 'archiveThread'
	| 'removeThread'
	| 'deleteThreadHistory'
	| 'promptThread'
	| 'cancelThread'
	| 'setThreadMode'
	| 'answerThreadPermission'
	| 'discoverSessions'
	| 'importSession'
>;

// Main reviews the exact captured snapshot and asks for a destination.
export type DiagnosticsService = ServiceMethods<'exportDiagnostics'>;

export interface WorkspaceServices {
	store?: DesktopStore;
	projects?: ProjectService;
	supervisor?: NanocoderSupervisor;
	threads?: ThreadService;
	diagnostics?: DiagnosticsService;
	restartProject?: (projectId: string) => Promise<SupervisorState>;
}
