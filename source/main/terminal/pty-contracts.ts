import type {Shell} from '@/main/terminal/shell';

export interface PtyLaunch {
	root: string;
	roots: string[];
	shell: Shell;
	env: Record<string, string>;
	cols: number;
	rows: number;
}

export interface PtyHost {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	clear(): void;
	stop(): Promise<void>;
}

export type PtyHostFactory = (
	launch: PtyLaunch,
	events: {
		data(data: string): void;
		exit(code: number | null, failed: boolean): void;
	},
) => Promise<PtyHost>;

export type WorkerCommand =
	| {type: 'start'; launch: PtyLaunch}
	| {type: 'write'; data: string}
	| {type: 'resize'; cols: number; rows: number}
	| {type: 'clear'; epoch: number}
	| {type: 'ack'};

export type WorkerEvent =
	| {type: 'ready'; pid: number; terminal?: string}
	| {type: 'data'; data: string; epoch: number}
	| {type: 'exit'; code: number}
	| {type: 'failed'};
