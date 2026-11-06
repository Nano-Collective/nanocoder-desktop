import {checkPage, pageOrigin, pageSecurity} from '@/main/browser/origin';
import {browserPartition, browserWebPreferences} from '@/main/browser/profile';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	BROWSER_BOUNDS_LIMIT,
	type BrowserBounds,
	type BrowserEvent,
	type BrowserRequests,
	type BrowserSnapshot,
} from '@/shared/browser';

const TITLE_LIMIT = 200;
const URL_LIMIT = 2_048;

export interface BrowserPage {
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
}

export interface BrowserViewHooks {
	allow(url: string): boolean;
	navigated(page: BrowserPage): void;
	loading(loading: boolean): void;
	failed(): void;
}

export interface BrowserViewHandle {
	load(url: string): Promise<void>;
	goBack(): void;
	goForward(): void;
	reload(): void;
	stop(): void;
	setBounds(bounds: BrowserBounds | null): void;
	destroy(): void;
}

export interface BrowserViewLaunch {
	partition: string;
	preferences: ReturnType<typeof browserWebPreferences>;
}

type State = Omit<BrowserSnapshot, 'origin' | 'security'>;

const closedState = (projectId: string, sequence: number): State => ({
	projectId,
	sequence,
	status: 'closed',
	url: null,
	title: null,
	canGoBack: false,
	canGoForward: false,
	blocked: null,
	reason: null,
});

export class BrowserService {
	private activeId: string | null = null;
	private closed = false;
	private generation = 0;
	private openSeq = 0;
	private blockedOpen = 0;
	private view: BrowserViewHandle | undefined;
	private bounds: BrowserBounds | null | undefined;
	private state: State = closedState('', 0);

	constructor(
		private readonly options: {
			project(id: string): {id: string; displayName: string} | undefined;
			emit(event: BrowserEvent): void;
			publicSites(): boolean;
			createView(
				launch: BrowserViewLaunch,
				hooks: BrowserViewHooks,
			): BrowserViewHandle;
		},
	) {}

	activate(projectId: string | null): void {
		this.activeId = projectId;
		++this.generation;
		this.destroyView();
		this.bounds = undefined;
		this.state = closedState(projectId ?? '', this.state.sequence);
		this.publish();
	}

	get({projectId}: BrowserRequests['get']): BrowserSnapshot {
		this.check(projectId);
		return this.snapshot();
	}

	async open(request: BrowserRequests['open']): Promise<BrowserSnapshot> {
		this.check(request.projectId);
		const verdict = checkPage(request.url, {
			publicSites: this.options.publicSites(),
		});
		if (!verdict.allowed) {
			if (verdict.reason === 'invalid')
				throw new IpcFailure('VALIDATION', 'That address is not valid');
			this.state = {
				...this.state,
				blocked: {url: bounded(request.url, URL_LIMIT), reason: verdict.reason},
			};
			this.publish();
			throw new IpcFailure(
				'DENIED',
				verdict.reason === 'public-off'
					? 'Public sites are off. Turn them on to open this page.'
					: 'Only http and https pages open here',
			);
		}
		const generation = this.generation;
		const openId = ++this.openSeq;
		let view: BrowserViewHandle;
		try {
			view = this.ensureView(request.projectId);
		} catch {
			this.state = {
				...this.state,
				status: 'failed',
				url: request.url,
				reason: 'The browser could not start',
			};
			this.publish();
			throw new IpcFailure('UNAVAILABLE', 'The browser could not start');
		}
		this.state = {
			...this.state,
			status: 'loading',
			url: request.url,
			blocked: null,
			reason: null,
		};
		this.publish();
		try {
			await view.load(request.url);
		} catch {
			if (this.stale(generation, openId)) throw this.changed();
			const blocked = this.blockedOpen === openId;
			this.state = {
				...this.state,
				status: 'failed',
				reason: blocked
					? 'The page tried to open a site that is not allowed'
					: 'The page could not load',
			};
			this.publish();
			throw blocked
				? new IpcFailure('DENIED', 'The page tried to open a blocked site')
				: new IpcFailure('UNAVAILABLE', 'The page could not load');
		}
		if (this.stale(generation, openId)) throw this.changed();
		this.state = {...this.state, status: 'ready', reason: null};
		this.publish();
		return this.snapshot();
	}

	navigate({projectId, action}: BrowserRequests['navigate']): BrowserSnapshot {
		this.check(projectId);
		const view = this.view;
		if (!view) throw new IpcFailure('UNAVAILABLE', 'Open a page first');
		if (action === 'back') view.goBack();
		else if (action === 'forward') view.goForward();
		else if (action === 'reload') view.reload();
		else view.stop();
		return this.snapshot();
	}

	setBounds({projectId, bounds}: BrowserRequests['setBounds']): null {
		this.check(projectId);
		if (bounds && !validBounds(bounds))
			throw new IpcFailure('VALIDATION', 'Invalid browser dimensions');
		this.bounds = bounds;
		this.view?.setBounds(bounds);
		return null;
	}

	closeView({projectId}: BrowserRequests['close']): BrowserSnapshot {
		this.check(projectId);
		++this.generation;
		this.destroyView();
		this.state = closedState(projectId, this.state.sequence);
		this.publish();
		return this.snapshot();
	}

	close(): Promise<void> {
		this.closed = true;
		++this.generation;
		this.destroyView();
		return Promise.resolve();
	}

	private hooks(generation: number): BrowserViewHooks {
		const live = () => generation === this.generation && !this.closed;
		return {
			allow: url => {
				if (!live()) return false;
				const verdict = checkPage(url, {
					publicSites: this.options.publicSites(),
				});
				if (verdict.allowed) return true;
				if (verdict.reason !== 'invalid') {
					this.blockedOpen = this.openSeq;
					this.state = {
						...this.state,
						blocked: {url: bounded(url, URL_LIMIT), reason: verdict.reason},
					};
					this.publish();
				}
				return false;
			},
			navigated: page => {
				if (!live() || !checkPage(page.url, {publicSites: true}).allowed)
					return;
				this.state = {
					...this.state,
					url: bounded(page.url, URL_LIMIT),
					title: bounded(page.title, TITLE_LIMIT),
					canGoBack: page.canGoBack,
					canGoForward: page.canGoForward,
					blocked: null,
				};
				this.publish();
			},
			loading: loading => {
				if (!live()) return;
				if (loading)
					this.state = {...this.state, status: 'loading', reason: null};
				else if (this.state.status === 'loading')
					this.state = {...this.state, status: 'ready'};
				else return;
				this.publish();
			},
			failed: () => {
				if (!live()) return;
				this.state = {
					...this.state,
					status: 'failed',
					reason: 'The page could not load',
				};
				this.publish();
			},
		};
	}

	private ensureView(projectId: string): BrowserViewHandle {
		if (this.view) return this.view;
		const partition = browserPartition(projectId);
		const view = this.options.createView(
			{partition, preferences: browserWebPreferences(partition)},
			this.hooks(this.generation),
		);
		if (this.bounds !== undefined) view.setBounds(this.bounds);
		this.view = view;
		return view;
	}

	private destroyView(): void {
		const view = this.view;
		this.view = undefined;
		view?.destroy();
	}

	private stale(generation: number, openId: number): boolean {
		return (
			generation !== this.generation || this.closed || openId !== this.openSeq
		);
	}

	private snapshot(): BrowserSnapshot {
		const {url} = this.state;
		return {
			...this.state,
			origin: url === null ? null : pageOrigin(url),
			security: url === null ? null : pageSecurity(url),
		};
	}

	private check(id: string): void {
		if (this.closed || id !== this.activeId || id !== this.state.projectId)
			throw this.changed();
		if (!this.options.project(id))
			throw new IpcFailure('NOT_FOUND', 'Project not found');
	}

	private changed(): IpcFailure {
		return new IpcFailure(
			'DENIED',
			'The browser belongs to the active project only',
		);
	}

	private publish(): void {
		++this.state.sequence;
		this.options.emit({type: 'snapshot', snapshot: this.snapshot()});
	}
}

function bounded(value: string, limit: number): string {
	return value.length > limit ? value.slice(0, limit) : value;
}

function validBounds(bounds: BrowserBounds): boolean {
	return [bounds.x, bounds.y, bounds.width, bounds.height].every(
		value =>
			Number.isInteger(value) && value >= 0 && value <= BROWSER_BOUNDS_LIMIT,
	);
}
