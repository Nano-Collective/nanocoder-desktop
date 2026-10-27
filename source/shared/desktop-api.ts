import type {
	AppInfo,
	ConnectResult,
	IpcResult,
	NanocoderRuntime,
} from '@/shared/ipc';

export interface DesktopApi {
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
	connectNanocoder(): Promise<IpcResult<ConnectResult>>;
}
