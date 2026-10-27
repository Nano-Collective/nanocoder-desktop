import type {AppInfo, IpcResult} from '@/shared/ipc';

export interface DesktopApi {
	getAppInfo(): Promise<IpcResult<AppInfo>>;
}
