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

export type WorkspaceApi = {
	[K in WorkspaceMethod]: (
		request: WorkspaceRequests[K],
	) => Promise<IpcResult<WorkspaceValues[K]>>;
};

export interface DesktopApi extends WorkspaceApi {
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
	connectNanocoder(): Promise<IpcResult<ConnectResult>>;
	// Returns a function that stops listening.
	onProjectEvent(listener: (event: ProjectEvent) => void): () => void;
}
