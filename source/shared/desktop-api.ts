import type {
	AppInfo,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
	TurnEvent,
	TurnResult,
} from '@/shared/ipc';

export interface DesktopApi {
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
	connectNanocoder(): Promise<IpcResult<ConnectResult>>;
	sendPrompt(text: string): Promise<IpcResult<TurnResult>>;
	answerPermission(id: string, optionId: string): Promise<IpcResult<null>>;
	// Returns a function that stops listening.
	onNanocoderEvent(listener: (event: TurnEvent) => void): () => void;
}
