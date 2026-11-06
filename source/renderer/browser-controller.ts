import type {
	BrowserApi,
	BrowserBounds,
	BrowserNavigation,
	BrowserSnapshot,
} from '@/shared/browser';
import {addressToUrl} from '@/shared/browser-address';
import type {DesktopSettings, IpcResult} from '@/shared/ipc';

export interface BrowserBridge {
	browser: BrowserApi;
	getSettings(
		request: Record<string, never>,
	): Promise<IpcResult<DesktopSettings>>;
	updateSettings(request: {
		patch: {publicBrowsingEnabled: boolean};
	}): Promise<IpcResult<DesktopSettings>>;
}

export interface BrowserState {
	projectId: string | null;
	snapshot: BrowserSnapshot | null;
	publicSites: boolean;
	loading: boolean;
	pending: boolean;
	error: string | null;
}

const sameBounds = (
	left: BrowserBounds | null,
	right: BrowserBounds | null,
): boolean =>
	left === right ||
	(left !== null &&
		right !== null &&
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height);

export class BrowserController {
	private state: BrowserState = {
		projectId: null,
		snapshot: null,
		publicSites: false,
		loading: false,
		pending: false,
		error: null,
	};
	private epoch = 0;
	private disposed = false;
	private sentBounds: BrowserBounds | null | undefined;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly bridge: BrowserBridge,
		private readonly changed: (state: BrowserState) => void,
	) {
		this.unsubscribe = bridge.browser.onEvent(event => {
			if (event.type !== 'snapshot') return;
			this.apply(event.snapshot);
		});
	}

	getState(): BrowserState {
		return this.state;
	}

	async select(projectId: string | null): Promise<void> {
		const epoch = ++this.epoch;
		this.sentBounds = undefined;
		this.update({
			projectId,
			snapshot: null,
			loading: projectId !== null,
			pending: false,
			error: null,
		});
		if (!projectId) return;
		try {
			const [snapshot, settings] = await Promise.all([
				this.bridge.browser.get({projectId}),
				this.bridge.getSettings({}).catch(() => undefined),
			]);
			if (!this.current(epoch)) return;
			if (settings?.ok)
				this.update({publicSites: settings.value.publicBrowsingEnabled});
			if (snapshot.ok) this.apply(snapshot.value);
			else this.update({error: snapshot.error.message});
		} catch {
			if (this.current(epoch))
				this.update({error: 'The browser could not be loaded'});
		} finally {
			if (this.current(epoch)) this.update({loading: false});
		}
	}

	async open(input: string): Promise<boolean> {
		const url = addressToUrl(input);
		if (url === '') return false;
		return this.request(projectId =>
			this.bridge.browser.open({projectId, url}),
		);
	}

	navigate(action: BrowserNavigation): Promise<boolean> {
		return this.request(projectId =>
			this.bridge.browser.navigate({projectId, action}),
		);
	}

	async setPublicSites(enabled: boolean): Promise<boolean> {
		if (this.disposed) return false;
		try {
			const result = await this.bridge.updateSettings({
				patch: {publicBrowsingEnabled: enabled},
			});
			if (this.disposed) return false;
			if (!result.ok) {
				this.update({error: result.error.message});
				return false;
			}
			this.update({publicSites: result.value.publicBrowsingEnabled});
			return true;
		} catch {
			if (!this.disposed)
				this.update({error: 'The setting could not be saved'});
			return false;
		}
	}

	async allowAndOpen(url: string): Promise<boolean> {
		return (await this.setPublicSites(true)) && this.open(url);
	}

	setBounds(bounds: BrowserBounds | null): void {
		const {projectId} = this.state;
		if (!projectId || this.disposed) return;
		if (this.sentBounds !== undefined && sameBounds(this.sentBounds, bounds))
			return;
		this.sentBounds = bounds;
		void this.bridge.browser.setBounds({projectId, bounds}).catch(() => {});
	}

	dispose(): void {
		this.disposed = true;
		++this.epoch;
		this.unsubscribe();
	}

	private async request(
		send: (projectId: string) => Promise<IpcResult<BrowserSnapshot>>,
	): Promise<boolean> {
		const {projectId} = this.state;
		if (!projectId || this.disposed) return false;
		const epoch = this.epoch;
		this.update({pending: true, error: null});
		try {
			const result = await send(projectId);
			if (!this.current(epoch)) return false;
			if (!result.ok) {
				this.update({error: result.error.message});
				return false;
			}
			this.apply(result.value);
			return true;
		} catch {
			if (this.current(epoch))
				this.update({error: 'The browser request failed'});
			return false;
		} finally {
			if (this.current(epoch)) this.update({pending: false});
		}
	}

	private apply(snapshot: BrowserSnapshot): void {
		if (snapshot.projectId !== this.state.projectId) return;
		if (snapshot.sequence <= (this.state.snapshot?.sequence ?? -1)) return;
		this.update({snapshot});
	}

	private current(epoch: number): boolean {
		return !this.disposed && epoch === this.epoch;
	}

	private update(patch: Partial<BrowserState>): void {
		this.state = {...this.state, ...patch};
		this.changed(this.state);
	}
}
