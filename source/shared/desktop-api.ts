import type {
	AppInfo,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	ProjectEvent,
	WorkspaceMethod,
	WorkspaceRequests,
	WorkspaceValues,
} from '@/shared/ipc';
import type {TerminalApi} from '@/shared/terminal';

export type WorkspaceApi = {
	[K in WorkspaceMethod]: (
		request: WorkspaceRequests[K],
	) => Promise<IpcResult<WorkspaceValues[K]>>;
};

export interface DesktopApi extends WorkspaceApi {
	terminal: TerminalApi;
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
	connectNanocoder(): Promise<IpcResult<ConnectResult>>;
	// Returns a function that stops listening.
	onProjectEvent(listener: (event: ProjectEvent) => void): () => void;
}
