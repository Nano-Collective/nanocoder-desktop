import type {
	AppInfo,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	ProjectEvent,
	TurnEvent,
	TurnResult,
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
	sendPrompt(text: string): Promise<IpcResult<TurnResult>>;
	cancelPrompt(): Promise<IpcResult<null>>;
	answerPermission(id: string, optionId: string): Promise<IpcResult<null>>;
	// Returns a function that stops listening.
	onNanocoderEvent(listener: (event: TurnEvent) => void): () => void;
	onProjectEvent(listener: (event: ProjectEvent) => void): () => void;
}
