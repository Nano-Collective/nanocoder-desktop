import type {FilesApi} from '@/shared/files';
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
import type {ReviewApi} from '@/shared/review';

export type WorkspaceApi = {
	[K in WorkspaceMethod]: (
		request: WorkspaceRequests[K],
	) => Promise<IpcResult<WorkspaceValues[K]>>;
};

export interface DesktopApi extends WorkspaceApi {
	files: FilesApi;
	review: ReviewApi;
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
	connectNanocoder(): Promise<IpcResult<ConnectResult>>;
	// Returns a function that stops listening.
	onProjectEvent(listener: (event: ProjectEvent) => void): () => void;
}
