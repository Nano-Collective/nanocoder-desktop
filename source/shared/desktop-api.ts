import type {
	AppInfo,
	ConnectedAgent,
	IpcResult,
	NanocoderRuntime,
} from '@/shared/ipc';

export interface DesktopApi {
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
	connectNanocoder(): Promise<IpcResult<ConnectedAgent | null>>;
}
