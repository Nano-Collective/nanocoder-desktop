import path from 'node:path';
import {
	checkPage,
	isLoopbackPage,
	pageOrigin,
	pageSecurity,
} from '@/main/browser/origin';
import {
	type BrowserProfileRef,
	browserPartition,
	browserWebPreferences,
	parseProfileKey,
	profileKey,
} from '@/main/browser/profile';
import type {BrowserProfiles} from '@/main/browser/profiles';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	BROWSER_BOUNDS_LIMIT,
	type BrowserBlockReason,
	type BrowserBounds,
	type BrowserDownload,
	type BrowserEvent,
	type BrowserProfileList,
	type BrowserRequests,
	type BrowserSnapshot,
} from '@/shared/browser';

const TITLE_LIMIT = 200;
const URL_LIMIT = 2_048;
const DOWNLOAD_LIMIT = 5;
const FILE_NAME_LIMIT = 120;

export interface BrowserDownloadItem {
	url: string;
	filename: string;
	totalBytes: number;
	setDestination(options: {defaultPath: string; title: string}): void;
	cancel(): void;
	onProgress(listener: (received: number, total: number) => void): void;
	onDone(
		listener: (state: 'completed' | 'cancelled' | 'interrupted') => void,
	): void;
}

function safeFileName(raw: string): string {
	const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '');
	const base = (cleaned.split(/[\\/]/).pop() ?? '')
		.trim()
		.replace(/[. ]+$/, '');
	if (base === '') return 'download';
	const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base);
	return `${reserved ? '_' : ''}${base}`.slice(0, FILE_NAME_LIMIT);
}

export interface BrowserPage {
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
}

export interface BrowserViewHooks {
	allow(url: string): boolean;
	// Whether a request from the page may go ahead; only agent actions restrict it.
	request(method: string): boolean;
	navigated(page: BrowserPage): void;
	loading(loading: boolean): void;
	failed(): void;
	popup(url: string): void;
	download(item: BrowserDownloadItem): void;
}

export interface BrowserViewHandle {
	load(url: string): Promise<'loaded' | 'aborted'>;
	goBack(): void;
	goForward(): void;
	peek(action: 'back' | 'forward'): string | null;
	reload(): void;
	stop(): void;
	setBounds(bounds: BrowserBounds | null): void;
	destroy(): void;
	driver?: PageDriver;
}

// What the agent's broker may do to the page: fixed scripts and real input, nothing else (SEC-13).
export interface PageDriver {
	run(code: string): Promise<unknown>;
	click(x: number, y: number): Promise<void>;
	insertText(text: string): Promise<void>;
	capture(): Promise<{
		data: string;
		mimeType: 'image/jpeg';
		width: number;
		height: number;
	}>;
}

// A refusal the agent may read: its message names the rule and never carries page detail.
export class AgentRefusal extends Error {}

export type AgentCancellation = 'navigation' | 'request' | 'download';

export interface AgentOutcome<T> {
	value: T;
	page: BrowserSnapshot;
	cancelled: AgentCancellation[];
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_ONLY =
	'Agent control is limited to local addresses (localhost, 127.x.x.x and [::1]) until desktop approvals arrive.';

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
	downloads: [],
	reason: null,
});

export class BrowserService {
	private activeId: string | null = null;
	private closed = false;
	private generation = 0;
	private openSeq = 0;
	private blockedOpen = 0;
	private committedOpen = 0;
	private blockedCount = 0;
	private downloadCount = 0;
	private view: BrowserViewHandle | undefined;
	private viewPartition: string | null = null;
	private viewProfile: BrowserProfileRef | null = null;
	private committed: {url: string; title: string} | null = null;
	private bounds: BrowserBounds | null | undefined;
	private state: State = closedState('', 0);
	private agentHolds = 0;
	private agentQueue: Promise<unknown> = Promise.resolve();
	private readonly cancelled = new Set<AgentCancellation>();

	constructor(
		private readonly options: {
			project(id: string): {id: string; displayName: string} | undefined;
			emit(event: BrowserEvent): void;
			publicSites(): boolean;
			downloadsPath(): string;
			profiles: Pick<
				BrowserProfiles,
				'list' | 'resolve' | 'create' | 'assign' | 'delete'
			>;
			clearData(partition: string): Promise<void>;
			openExternal(url: string): Promise<boolean>;
			createView(
				launch: BrowserViewLaunch,
				hooks: BrowserViewHooks,
			): BrowserViewHandle;
			delay?: (ms: number) => Promise<void>;
		},
	) {}

	activate(projectId: string | null): void {
		this.activeId = projectId;
		++this.generation;
		this.destroyView();
		this.state = closedState(projectId ?? '', this.state.sequence);
		this.publish();
	}

	get({projectId}: BrowserRequests['get']): BrowserSnapshot {
		this.check(projectId);
		return this.snapshot();
	}

	// A read for the agent's browser server, which refuses rather than throws.
	pageFor(projectId: string): BrowserSnapshot | null {
		if (
			this.closed ||
			projectId !== this.activeId ||
			projectId !== this.state.projectId ||
			!this.options.project(projectId)
		)
			return null;
		return this.snapshot();
	}

	agentOpen(projectId: string, url: string): Promise<AgentOutcome<null>> {
		return this.agent(projectId, false, async () => {
			const verdict = checkPage(url, {publicSites: false});
			if (!verdict.allowed)
				throw new AgentRefusal(
					verdict.reason === 'invalid'
						? 'That is not a valid http or https address.'
						: verdict.reason === 'scheme'
							? 'Only http and https pages open in the in-app browser.'
							: LOCAL_ONLY,
				);
			try {
				await this.open({projectId, url});
			} catch (error) {
				if (error instanceof IpcFailure) throw new AgentRefusal(error.message);
				throw error;
			}
			return null;
		});
	}

	agentNavigate(
		projectId: string,
		action: 'back' | 'reload',
	): Promise<AgentOutcome<null>> {
		return this.agent(projectId, true, async () => {
			const target =
				action === 'back' ? this.view?.peek('back') : this.state.url;
			if (!target) throw new AgentRefusal('There is no earlier page.');
			if (!isLoopbackPage(target)) throw new AgentRefusal(LOCAL_ONLY);
			this.navigate({projectId, action});
			return null;
		});
	}

	agentUse<T>(
		projectId: string,
		use: (driver: PageDriver) => Promise<T>,
	): Promise<AgentOutcome<T>> {
		return this.agent(projectId, true, async () => {
			const driver = this.view?.driver;
			if (!driver)
				throw new AgentRefusal('The in-app browser cannot be driven.');
			return use(driver);
		});
	}

	// Looking at the page holds nothing, so the user's own requests are never cancelled by it.
	agentRead<T>(
		projectId: string,
		read: (driver: PageDriver) => Promise<T>,
	): Promise<AgentOutcome<T>> {
		return this.agent(
			projectId,
			true,
			async () => {
				const driver = this.view?.driver;
				if (!driver)
					throw new AgentRefusal('The in-app browser cannot be driven.');
				return read(driver);
			},
			false,
		);
	}

	private agent<T>(
		projectId: string,
		needsPage: boolean,
		act: () => Promise<T>,
		hold = true,
	): Promise<AgentOutcome<T>> {
		const run = this.agentQueue.then(async () => {
			this.agentCheck(projectId, needsPage);
			const generation = this.generation;
			this.cancelled.clear();
			if (hold) this.agentHolds++;
			try {
				const value = await act();
				if (hold) await this.settle(generation);
				if (generation !== this.generation || this.closed)
					throw new AgentRefusal(
						'The in-app browser changed during the action, so its result is unknown.',
					);
				return {value, page: this.snapshot(), cancelled: [...this.cancelled]};
			} finally {
				if (hold) this.agentHolds--;
			}
		});
		this.agentQueue = run.catch(() => undefined);
		return run;
	}

	private agentCheck(projectId: string, needsPage: boolean): void {
		if (this.pageFor(projectId) === null)
			throw new AgentRefusal(
				'The in-app browser is not showing this project. The user can open this project in Nanocoder Desktop to use it.',
			);
		// The agent acts only where the user can see it.
		if (!this.bounds)
			throw new AgentRefusal(
				'The in-app browser is not on screen. Ask the user to open the browser tab, then try again.',
			);
		if (!needsPage) return;
		if (!this.view || this.state.url === null || this.state.status === 'closed')
			throw new AgentRefusal(
				'No page is open in the in-app browser. Use desktop_browser_open first.',
			);
		if (!isLoopbackPage(this.state.url))
			throw new AgentRefusal(`The page is not a local address. ${LOCAL_ONLY}`);
	}

	// Gives a navigation the action started time to begin, then to finish.
	private async settle(generation: number): Promise<void> {
		const delay =
			this.options.delay ??
			((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
		const live = () => generation === this.generation && !this.closed;
		for (let i = 0; i < 8 && live() && this.state.status !== 'loading'; i++)
			await delay(50);
		for (let i = 0; i < 200 && live() && this.state.status === 'loading'; i++)
			await delay(50);
	}

	async open(request: BrowserRequests['open']): Promise<BrowserSnapshot> {
		this.check(request.projectId);
		const verdict = checkPage(request.url, {
			publicSites: this.options.publicSites(),
		});
		if (!verdict.allowed) {
			if (verdict.reason === 'invalid')
				throw new IpcFailure('VALIDATION', 'That address is not valid');
			this.block(request.url, verdict.reason);
			throw new IpcFailure(
				'DENIED',
				verdict.reason === 'public-off'
					? 'Public sites are off. Turn them on to open this page.'
					: 'Only http and https pages open here',
			);
		}
		const generation = this.generation;
		const openId = ++this.openSeq;
		const previous = this.state;
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
		let outcome: 'loaded' | 'aborted';
		try {
			outcome = await view.load(request.url);
		} catch {
			if (this.stale(generation, openId)) throw this.changed();
			throw this.failOpen(openId);
		}
		if (this.stale(generation, openId)) throw this.changed();
		if (outcome === 'aborted') {
			if (this.blockedOpen === openId) throw this.failOpen(openId);
			return this.cancelOpen(openId, previous);
		}
		this.state = {...this.state, status: 'ready', reason: null};
		this.publish();
		return this.snapshot();
	}

	private block(url: string, reason: BrowserBlockReason): void {
		this.state = {
			...this.state,
			blocked: {
				url: bounded(url, URL_LIMIT),
				reason,
				id: ++this.blockedCount,
			},
		};
		this.publish();
	}

	private failOpen(openId: number): IpcFailure {
		const blocked = this.blockedOpen === openId;
		this.state = {
			...this.state,
			status: 'failed',
			reason: blocked
				? 'The page tried to open a site that is not allowed'
				: 'The page could not load',
		};
		this.publish();
		return blocked
			? new IpcFailure('DENIED', 'The page tried to open a blocked site')
			: new IpcFailure('UNAVAILABLE', 'The page could not load');
	}

	private cancelOpen(openId: number, previous: State): BrowserSnapshot {
		if (this.committedOpen === openId)
			this.state = {...this.state, status: 'ready', reason: null};
		else
			this.state = {
				...this.state,
				url: previous.url,
				title: previous.title,
				canGoBack: previous.canGoBack,
				canGoForward: previous.canGoForward,
				status:
					previous.url === null
						? 'closed'
						: previous.status === 'loading'
							? 'ready'
							: previous.status,
				reason: null,
			};
		this.publish();
		return this.snapshot();
	}

	navigate({projectId, action}: BrowserRequests['navigate']): BrowserSnapshot {
		this.check(projectId);
		const view = this.view;
		if (!view) throw new IpcFailure('UNAVAILABLE', 'Open a page first');
		const target =
			action === 'reload'
				? this.state.url
				: action === 'back' || action === 'forward'
					? view.peek(action)
					: null;
		if (target !== null) {
			const verdict = checkPage(target, {
				publicSites: this.options.publicSites(),
			});
			if (!verdict.allowed && verdict.reason !== 'invalid') {
				this.block(target, verdict.reason);
				throw new IpcFailure(
					'DENIED',
					verdict.reason === 'public-off'
						? 'Public sites are off. Turn them on to open this page.'
						: 'Only http and https pages open here',
				);
			}
		}
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
		this.resetView(projectId);
		return this.snapshot();
	}

	currentPage({
		projectId,
	}: {
		projectId: string;
	}): {url: string; title: string} | null {
		this.check(projectId);
		return this.committed ? {...this.committed} : null;
	}

	profiles({projectId}: BrowserRequests['profiles']): BrowserProfileList {
		this.check(projectId);
		return this.profileList(projectId);
	}

	setProfile({
		projectId,
		profile,
	}: BrowserRequests['setProfile']): BrowserSnapshot {
		this.check(projectId);
		const choice = parseProfileKey(profile);
		if (!choice) throw new IpcFailure('VALIDATION', 'Unknown browser profile');
		const current = this.options.profiles.resolve(projectId);
		if (profileKey(current) === profileKey(choice)) return this.snapshot();
		this.options.profiles.assign(projectId, choice);
		this.resetView(projectId);
		return this.snapshot();
	}

	createProfile({
		projectId,
		name,
	}: BrowserRequests['createProfile']): BrowserProfileList {
		this.check(projectId);
		this.options.profiles.create(name);
		return this.profileList(projectId);
	}

	async deleteProfile({
		projectId,
		id,
	}: BrowserRequests['deleteProfile']): Promise<BrowserProfileList> {
		this.check(projectId);
		this.options.profiles.delete(id);
		const partition = browserPartition(null, {kind: 'named', id});
		if (this.viewPartition === partition) this.resetView(projectId);
		await this.options.clearData(partition);
		return this.profileList(projectId);
	}

	async clearData({
		projectId,
		profile,
	}: BrowserRequests['clearData']): Promise<BrowserSnapshot> {
		this.check(projectId);
		const choice = parseProfileKey(profile);
		if (!choice) throw new IpcFailure('VALIDATION', 'Unknown browser profile');
		if (
			choice.kind === 'named' &&
			!this.options.profiles.list().some(entry => entry.id === choice.id)
		)
			throw new IpcFailure('NOT_FOUND', 'That browser profile does not exist');
		const partition = browserPartition(projectId, choice);
		if (this.viewPartition === partition) this.resetView(projectId);
		await this.options.clearData(partition);
		return this.snapshot();
	}

	async openExternal({
		projectId,
	}: BrowserRequests['openExternal']): Promise<{opened: boolean}> {
		this.check(projectId);
		const {url} = this.state;
		if (url === null) throw new IpcFailure('UNAVAILABLE', 'Open a page first');
		if (!checkPage(url, {publicSites: true}).allowed)
			throw new IpcFailure('DENIED', 'Only http and https pages open outside');
		return {opened: await this.options.openExternal(url)};
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
				if (this.agentHolds > 0 && !isLoopbackPage(url)) {
					this.cancelled.add('navigation');
					return false;
				}
				const verdict = checkPage(url, {
					publicSites: this.options.publicSites(),
				});
				if (verdict.allowed) return true;
				if (verdict.reason !== 'invalid') {
					this.blockedOpen = this.openSeq;
					this.block(url, verdict.reason);
				}
				return false;
			},
			navigated: page => {
				if (!live()) return;
				const verdict = checkPage(page.url, {
					publicSites: this.options.publicSites(),
				});
				if (!verdict.allowed) {
					if (verdict.reason === 'public-off') {
						this.block(page.url, verdict.reason);
						this.view?.stop();
					}
					return;
				}
				this.committedOpen = this.openSeq;
				this.committed = {
					url: bounded(page.url, URL_LIMIT),
					title: bounded(page.title, TITLE_LIMIT),
				};
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
			request: method => {
				if (this.agentHolds === 0 || SAFE_METHODS.has(method.toUpperCase()))
					return true;
				this.cancelled.add('request');
				return false;
			},
			download: item => {
				if (!live()) {
					item.cancel();
					return;
				}
				if (this.agentHolds > 0) {
					item.cancel();
					this.cancelled.add('download');
					return;
				}
				const target = item.url.startsWith('blob:')
					? item.url.slice('blob:'.length)
					: item.url;
				const verdict = checkPage(target, {
					publicSites: this.options.publicSites(),
				});
				if (!verdict.allowed) {
					item.cancel();
					if (verdict.reason !== 'invalid')
						this.block(item.url, verdict.reason);
					return;
				}
				const id = ++this.downloadCount;
				const name = safeFileName(item.filename);
				const entry: BrowserDownload = {
					id,
					name,
					state: 'asking',
					received: 0,
					total: Math.max(0, item.totalBytes),
				};
				this.state = {
					...this.state,
					downloads: [...this.state.downloads, entry].slice(-DOWNLOAD_LIMIT),
				};
				this.publish();
				item.setDestination({
					defaultPath: path.join(this.options.downloadsPath(), name),
					title: 'Save download',
				});
				const update = (patch: Partial<BrowserDownload>) => {
					if (!live()) return;
					if (!this.state.downloads.some(candidate => candidate.id === id))
						return;
					this.state = {
						...this.state,
						downloads: this.state.downloads.map(candidate =>
							candidate.id === id ? {...candidate, ...patch} : candidate,
						),
					};
					this.publish();
				};
				item.onProgress((received, total) =>
					update({state: 'progress', received, total: Math.max(0, total)}),
				);
				item.onDone(state =>
					update({
						state:
							state === 'completed'
								? 'done'
								: state === 'cancelled'
									? 'cancelled'
									: 'failed',
					}),
				);
			},
			popup: url => {
				if (!live()) return;
				this.block(url, 'popup');
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

	private profileList(projectId: string): BrowserProfileList {
		return {
			profiles: this.options.profiles.list(),
			current: profileKey(this.options.profiles.resolve(projectId)),
		};
	}

	private resetView(projectId: string): void {
		++this.generation;
		this.destroyView();
		this.state = closedState(projectId, this.state.sequence);
		this.publish();
	}

	private ensureView(projectId: string): BrowserViewHandle {
		if (this.view) return this.view;
		const profile = this.options.profiles.resolve(projectId);
		const partition = browserPartition(projectId, profile);
		const view = this.options.createView(
			{partition, preferences: browserWebPreferences(partition)},
			this.hooks(this.generation),
		);
		if (this.bounds !== undefined) view.setBounds(this.bounds);
		this.view = view;
		this.viewPartition = partition;
		this.viewProfile = profile;
		return view;
	}

	private destroyView(): void {
		const view = this.view;
		const partition = this.viewPartition;
		const incognito = this.viewProfile?.kind === 'incognito';
		this.view = undefined;
		this.committed = null;
		this.viewPartition = null;
		this.viewProfile = null;
		view?.destroy();
		if (view && incognito && partition)
			void this.options.clearData(partition).catch(() => {});
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
