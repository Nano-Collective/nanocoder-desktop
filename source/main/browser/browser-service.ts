import {isLoopbackPage} from '@/main/browser/origin';
import {browserPartition, browserWebPreferences} from '@/main/browser/profile';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	BROWSER_BOUNDS_LIMIT,
	type BrowserBounds,
	type BrowserEvent,
	type BrowserRequests,
	type BrowserSnapshot,
} from '@/shared/browser';

export interface BrowserViewHandle {
	load(url: string): Promise<void>;
	setBounds(bounds: BrowserBounds | null): void;
	destroy(): void;
}

export interface BrowserViewLaunch {
	partition: string;
	preferences: ReturnType<typeof browserWebPreferences>;
}

export class BrowserService {
	private activeId: string | null = null;
	private closed = false;
	private generation = 0;
	private view: BrowserViewHandle | undefined;
	private bounds: BrowserBounds | null | undefined;
	private state: BrowserSnapshot = {
		projectId: '',
		sequence: 0,
		status: 'closed',
		url: null,
		reason: null,
	};

	constructor(
		private readonly options: {
			project(id: string): {id: string; displayName: string} | undefined;
			emit(event: BrowserEvent): void;
			createView(launch: BrowserViewLaunch): BrowserViewHandle;
		},
	) {}

	activate(projectId: string | null): void {
		this.activeId = projectId;
		++this.generation;
		this.destroyView();
		this.bounds = undefined;
		this.state = {
			...this.state,
			projectId: projectId ?? '',
			status: 'closed',
			url: null,
			reason: null,
		};
		this.publish();
	}

	get({projectId}: BrowserRequests['get']): BrowserSnapshot {
		this.check(projectId);
		return {...this.state};
	}

	async open(request: BrowserRequests['open']): Promise<BrowserSnapshot> {
		this.check(request.projectId);
		if (!isLoopbackPage(request.url))
			throw new IpcFailure('DENIED', 'Only pages on localhost open here');
		const generation = this.generation;
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
			reason: null,
		};
		this.publish();
		try {
			await view.load(request.url);
		} catch {
			if (generation !== this.generation || this.closed) throw this.changed();
			this.state = {
				...this.state,
				status: 'failed',
				reason: 'The page could not load',
			};
			this.publish();
			throw new IpcFailure('UNAVAILABLE', 'The page could not load');
		}
		if (generation !== this.generation || this.closed) throw this.changed();
		this.state = {...this.state, status: 'ready', reason: null};
		this.publish();
		return this.get(request);
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
		this.state = {...this.state, status: 'closed', url: null, reason: null};
		this.publish();
		return this.get({projectId});
	}

	close(): Promise<void> {
		this.closed = true;
		++this.generation;
		this.destroyView();
		return Promise.resolve();
	}

	private ensureView(projectId: string): BrowserViewHandle {
		if (this.view) return this.view;
		const partition = browserPartition(projectId);
		const view = this.options.createView({
			partition,
			preferences: browserWebPreferences(partition),
		});
		if (this.bounds !== undefined) view.setBounds(this.bounds);
		this.view = view;
		return view;
	}

	private destroyView(): void {
		const view = this.view;
		this.view = undefined;
		view?.destroy();
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
		this.options.emit({type: 'snapshot', snapshot: {...this.state}});
	}
}

function validBounds(bounds: BrowserBounds): boolean {
	return [bounds.x, bounds.y, bounds.width, bounds.height].every(
		value =>
			Number.isInteger(value) && value >= 0 && value <= BROWSER_BOUNDS_LIMIT,
	);
}
