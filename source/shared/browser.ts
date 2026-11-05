import type {IpcResult} from '@/shared/ipc';

export const BROWSER_CHANNELS = {
	get: 'browser:get',
	open: 'browser:open',
	setBounds: 'browser:set-bounds',
	close: 'browser:close',
	event: 'browser:event',
} as const;

export const BROWSER_BOUNDS_LIMIT = 16_384;

export interface BrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BrowserSnapshot {
	projectId: string;
	sequence: number;
	status: 'closed' | 'loading' | 'ready' | 'failed';
	url: string | null;
	reason: string | null;
}

export type BrowserEvent = {type: 'snapshot'; snapshot: BrowserSnapshot};

export interface BrowserRequests {
	get: {projectId: string};
	open: {projectId: string; url: string};
	setBounds: {projectId: string; bounds: BrowserBounds | null};
	close: {projectId: string};
}

// Layout reports are frequent, so they return no snapshot.
export type BrowserResults = {
	[K in keyof BrowserRequests]: K extends 'setBounds' ? null : BrowserSnapshot;
};

export type BrowserApi = {
	[K in keyof BrowserRequests]: (
		request: BrowserRequests[K],
	) => Promise<IpcResult<BrowserResults[K]>>;
} & {onEvent(listener: (event: BrowserEvent) => void): () => void};
