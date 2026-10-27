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
	sendPrompt: 'nanocoder:send-prompt',
	answerPermission: 'nanocoder:answer-permission',
	// Pushed from main to the renderer.
	nanocoderEvent: 'nanocoder:event',
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

export type NanocoderMode =
	| 'normal'
	| 'auto-accept'
	| 'yolo'
	| 'plan'
	| 'architect';

export interface SessionInfo {
	id: string;
	mode: NanocoderMode;
}

export type ConnectResult =
	| {status: 'connected'; agent: ConnectedAgent; session: SessionInfo}
	| {status: 'untrusted'; message: string}
	| {status: 'cancelled'};

export type PermissionOptionKind =
	| 'allow_once'
	| 'allow_always'
	| 'reject_once'
	| 'reject_always';

// Nanocoder's own options, passed on unchanged (ACP-10).
export interface PermissionOptionInfo {
	id: string;
	name: string;
	kind: PermissionOptionKind;
}

export interface PermissionRequestInfo {
	id: string;
	title: string;
	options: PermissionOptionInfo[];
}

export type TurnEvent =
	| {type: 'text'; text: string}
	| {type: 'tool'; id: string; title?: string; status?: string}
	| {type: 'permission'; request: PermissionRequestInfo}
	| {type: 'permission-closed'; id: string};

export type StopReason =
	| 'end_turn'
	| 'max_tokens'
	| 'max_turn_requests'
	| 'refusal'
	| 'cancelled';

export interface TurnResult {
	stopReason: StopReason;
}
