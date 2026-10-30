import type {IpcResult} from '@/shared/ipc';

export const TERMINAL_CHANNELS = {
	get: 'terminal:get',
	start: 'terminal:start',
	stop: 'terminal:stop',
	restart: 'terminal:restart',
	resize: 'terminal:resize',
	write: 'terminal:write',
	clear: 'terminal:clear',
	event: 'terminal:event',
} as const;

export interface AgentCommandInfo {
	threadId: string;
	command: string;
	approval: 'unknown' | 'pending' | 'allowed' | 'rejected' | 'cancelled';
}

export interface TerminalSnapshot {
	projectId: string;
	sequence: number;
	status: 'stopped' | 'starting' | 'running' | 'exited' | 'failed';
	shell: string | null;
	cols: number;
	rows: number;
	output: string;
	truncated: boolean;
	exitCode: number | null;
	reason: string | null;
	agentCommand: AgentCommandInfo | null;
}

export type TerminalEvent =
	| {type: 'snapshot'; snapshot: TerminalSnapshot}
	| {type: 'data'; projectId: string; sequence: number; data: string};

export interface TerminalRequests {
	get: {projectId: string};
	start: {projectId: string};
	stop: {projectId: string};
	restart: {projectId: string};
	resize: {projectId: string; cols: number; rows: number};
	write: {projectId: string; data: string};
	clear: {projectId: string};
}

export type TerminalApi = {
	[K in keyof TerminalRequests]: (
		request: TerminalRequests[K],
	) => Promise<IpcResult<TerminalSnapshot>>;
} & {onEvent(listener: (event: TerminalEvent) => void): () => void};
