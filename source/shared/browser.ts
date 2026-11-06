import type {IpcResult} from '@/shared/ipc';

export const BROWSER_CHANNELS = {
	get: 'browser:get',
	open: 'browser:open',
	navigate: 'browser:navigate',
	setBounds: 'browser:set-bounds',
	close: 'browser:close',
	profiles: 'browser:profiles',
	setProfile: 'browser:set-profile',
	createProfile: 'browser:create-profile',
	deleteProfile: 'browser:delete-profile',
	clearData: 'browser:clear-data',
	openExternal: 'browser:open-external',
	event: 'browser:event',
} as const;

export const BROWSER_BOUNDS_LIMIT = 16_384;

export interface BrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type BrowserBlockReason = 'public-off' | 'scheme' | 'popup';

export interface BrowserSnapshot {
	projectId: string;
	sequence: number;
	status: 'closed' | 'loading' | 'ready' | 'failed';
	url: string | null;
	title: string | null;
	origin: string | null;
	security: 'local' | 'secure' | 'insecure' | null;
	canGoBack: boolean;
	canGoForward: boolean;
	// The last address the policy refused, so the panel can explain and offer the setting.
	blocked: {url: string; reason: BrowserBlockReason; id: number} | null;
	downloads: BrowserDownload[];
	reason: string | null;
}

export interface BrowserDownload {
	id: number;
	name: string;
	state: 'asking' | 'progress' | 'done' | 'cancelled' | 'failed';
	received: number;
	total: number;
}

export interface BrowserProfileList {
	profiles: Array<{id: string; name: string}>;
	// 'project', 'default', 'incognito' or the id of a named profile.
	current: string;
}

export type BrowserNavigation = 'back' | 'forward' | 'reload' | 'stop';

export type BrowserEvent = {type: 'snapshot'; snapshot: BrowserSnapshot};

export interface BrowserRequests {
	get: {projectId: string};
	open: {projectId: string; url: string};
	navigate: {projectId: string; action: BrowserNavigation};
	setBounds: {projectId: string; bounds: BrowserBounds | null};
	close: {projectId: string};
	profiles: {projectId: string};
	setProfile: {projectId: string; profile: string};
	createProfile: {projectId: string; name: string};
	deleteProfile: {projectId: string; id: string};
	clearData: {projectId: string; profile: string};
	openExternal: {projectId: string};
}

// Layout reports are frequent, so they return no snapshot.
export interface BrowserResults {
	get: BrowserSnapshot;
	open: BrowserSnapshot;
	navigate: BrowserSnapshot;
	setBounds: null;
	close: BrowserSnapshot;
	profiles: BrowserProfileList;
	setProfile: BrowserSnapshot;
	createProfile: BrowserProfileList;
	deleteProfile: BrowserProfileList;
	clearData: BrowserSnapshot;
	openExternal: {opened: boolean};
}

export type BrowserApi = {
	[K in keyof BrowserRequests]: (
		request: BrowserRequests[K],
	) => Promise<IpcResult<BrowserResults[K]>>;
} & {onEvent(listener: (event: BrowserEvent) => void): () => void};
