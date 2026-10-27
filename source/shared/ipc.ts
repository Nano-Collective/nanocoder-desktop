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
	getNanocoderRuntime: 'nanocoder:get-runtime',
	connectNanocoder: 'nanocoder:connect',
} as const;

export interface AppInfo {
	name: string;
	version: string;
}

export interface NanocoderRuntime {
	nodePath: string;
	nodeVersion: string;
	cliPath: string;
	version: string;
	source: 'override' | 'path';
}

export interface AgentCapabilities {
	loadSession: boolean;
	sessions: {close: boolean; delete: boolean; list: boolean; resume: boolean};
	prompt: {image: boolean; audio: boolean; embeddedContext: boolean};
	mcp: {http: boolean; sse: boolean};
}

export interface ConnectedAgent {
	root: string;
	protocolVersion: number;
	name: string | null;
	version: string | null;
	capabilities: AgentCapabilities;
}
