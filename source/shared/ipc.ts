export type ErrorCode =
	| 'VALIDATION'
	| 'NOT_FOUND'
	| 'OUTSIDE_ROOT'
	| 'LIMIT'
	| 'UNSUPPORTED'
	| 'AGENT_UNAVAILABLE'
	| 'BUSY'
	| 'DENIED'
	| 'INTERNAL';

export interface IpcError {
	code: ErrorCode;
	message: string;
	retryable: boolean;
}

export type IpcResult<T> = {ok: true; value: T} | {ok: false; error: IpcError};

export const CHANNELS = {
	getAppInfo: 'app:get-info',
} as const;

export interface AppInfo {
	name: string;
	version: string;
}
