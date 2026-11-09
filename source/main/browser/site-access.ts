export type SiteState = 'allowed' | 'blocked' | 'unknown';

export const SITE_LIMIT = 200;

// Public sites the agent may use (DEC-50): per chat in memory, and the user's saved "always allow" list.
export class SiteAccess {
	private readonly allowed = new Map<string, Set<string>>();
	private readonly blocked = new Map<string, Set<string>>();

	constructor(
		private readonly saved: {
			get(): readonly string[];
			set(list: string[]): void;
		},
	) {}

	state(sessionId: string, origin: string): SiteState {
		if (this.blocked.get(sessionId)?.has(origin)) return 'blocked';
		if (this.saved.get().includes(origin)) return 'allowed';
		return this.allowed.get(sessionId)?.has(origin) ? 'allowed' : 'unknown';
	}

	allowThread(sessionId: string, origin: string): void {
		this.add(this.allowed, sessionId, origin);
	}

	block(sessionId: string, origin: string): void {
		this.add(this.blocked, sessionId, origin);
	}

	allowAlways(origin: string): boolean {
		const list = this.saved.get();
		if (list.includes(origin)) return true;
		if (list.length >= SITE_LIMIT) return false;
		this.saved.set([...list, origin]);
		return true;
	}

	forget(origin: string): boolean {
		const list = this.saved.get();
		if (!list.includes(origin)) return false;
		this.saved.set(list.filter(entry => entry !== origin));
		return true;
	}

	list(): string[] {
		return [...this.saved.get()];
	}

	private add(
		map: Map<string, Set<string>>,
		sessionId: string,
		origin: string,
	) {
		const set = map.get(sessionId) ?? new Set<string>();
		set.add(origin);
		map.set(sessionId, set);
	}
}
