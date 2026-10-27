import type {AppInfo, IpcResult, NanocoderRuntime} from '@/shared/ipc';

export interface DesktopApi {
	getAppInfo(): Promise<IpcResult<AppInfo>>;
	getNanocoderRuntime(): Promise<IpcResult<NanocoderRuntime>>;
}
