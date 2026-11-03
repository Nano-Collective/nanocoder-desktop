import {type FSWatcher, watch} from 'node:fs';

export interface WatchHandle {
	close(): void;
}

export type WatchListener = (event: string, filename: string | null) => void;

export interface WatchChange {
	directories: string[];
	overflow: boolean;
	git: boolean;
}

export interface WatcherOptions {
	onChange(change: WatchChange): void;
	// The platform ran out of watches (for example the Linux inotify limit).
	onLimit(): void;
	debounceMs?: number;
	maxDirectories?: number;
	// Injected so tests need no real file events and no real timers.
	watch?(
		root: string,
		listener: WatchListener,
		failed: (error: Error) => void,
	): WatchHandle;
	schedule?: {
		set(callback: () => void, milliseconds: number): unknown;
		clear(handle: unknown): void;
	};
}

const GIT_STATE = new Set(['HEAD', 'index', 'ORIG_HEAD', 'MERGE_HEAD']);

function nativeWatch(
	root: string,
	listener: WatchListener,
	failed: (error: Error) => void,
): WatchHandle {
	const watcher: FSWatcher = watch(
		root,
		{recursive: true, persistent: false},
		(event, filename) => listener(event, filename ? String(filename) : null),
	);
	watcher.on('error', failed);
	return watcher;
}

// One recursive watch per project, coalescing bursts before anything refreshes
// (FILE-05). Events inside .git are ignored except the files that show a change
// of branch or index (GIT-06), and node_modules never refreshes the tree.
export class ProjectWatcher {
	private handle: WatchHandle | undefined;
	private timer: unknown;
	private pending = new Set<string>();
	private git = false;
	private overflow = false;
	private limited = false;
	private closed = false;

	constructor(
		readonly root: string,
		private readonly options: WatcherOptions,
	) {}

	start(): 'active' | 'limited' {
		try {
			this.handle = (this.options.watch ?? nativeWatch)(
				this.root,
				(event, filename) => this.receive(filename),
				error => this.fail(error),
			);
		} catch (error) {
			this.fail(error as Error);
		}
		return this.state();
	}

	state(): 'active' | 'limited' {
		return this.limited ? 'limited' : 'active';
	}

	close(): void {
		this.closed = true;
		this.handle?.close();
		this.handle = undefined;
		this.cancel();
	}

	private fail(_error: Error): void {
		if (this.limited || this.closed) return;
		this.limited = true;
		this.handle?.close();
		this.handle = undefined;
		this.cancel();
		this.options.onLimit();
	}

	private receive(filename: string | null): void {
		if (this.closed || this.limited) return;
		if (filename === null) {
			this.overflow = true;
			return this.arm();
		}
		const segments = filename.split(/[\\/]/u).filter(Boolean);
		if (segments[0] === '.git') {
			const rest = segments.slice(1);
			if (rest[0] === 'refs' || (rest.length === 1 && GIT_STATE.has(rest[0]))) {
				this.git = true;
				this.arm();
			}
			return;
		}
		if (segments.includes('node_modules')) return;
		this.pending.add(segments.slice(0, -1).join('/'));
		if (this.pending.size > (this.options.maxDirectories ?? 200))
			this.overflow = true;
		this.arm();
	}

	private arm(): void {
		if (this.timer !== undefined) return;
		const schedule = this.options.schedule ?? {
			set: (callback: () => void, ms: number) => {
				const timer = setTimeout(callback, ms);
				timer.unref?.();
				return timer;
			},
			clear: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
		};
		this.timer = schedule.set(() => {
			this.timer = undefined;
			this.flush();
		}, this.options.debounceMs ?? 300);
	}

	private cancel(): void {
		if (this.timer === undefined) return;
		(
			this.options.schedule?.clear ??
			((h: unknown) => clearTimeout(h as NodeJS.Timeout))
		)(this.timer);
		this.timer = undefined;
	}

	private flush(): void {
		if (this.closed) return;
		const change: WatchChange = {
			directories: this.overflow ? [] : [...this.pending].sort(),
			overflow: this.overflow,
			git: this.git,
		};
		this.pending = new Set();
		this.overflow = false;
		this.git = false;
		this.options.onChange(change);
	}
}

// Only the project being browsed is watched; switching projects closes the old watch.
export class WatchManager {
	private current:
		| {projectId: string; root: string; watcher: ProjectWatcher}
		| undefined;

	constructor(
		private readonly options: Omit<WatcherOptions, 'onChange' | 'onLimit'> & {
			onChange(projectId: string, change: WatchChange): void;
			onLimit(projectId: string): void;
		},
	) {}

	ensure(projectId: string, root: string): 'active' | 'limited' {
		if (this.current?.projectId === projectId && this.current.root === root)
			return this.current.watcher.state();
		this.close();
		const watcher = new ProjectWatcher(root, {
			...this.options,
			onChange: change => this.options.onChange(projectId, change),
			onLimit: () => this.options.onLimit(projectId),
		});
		this.current = {projectId, root, watcher};
		return watcher.start();
	}

	state(projectId: string): 'active' | 'limited' {
		return this.current?.projectId === projectId
			? this.current.watcher.state()
			: 'active';
	}

	closeProject(projectId: string): void {
		if (this.current?.projectId === projectId) this.close();
	}

	close(): void {
		this.current?.watcher.close();
		this.current = undefined;
	}
}
