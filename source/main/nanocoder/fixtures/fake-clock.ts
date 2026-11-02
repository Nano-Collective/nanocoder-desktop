export class FakeClock {
	private time = 1_700_000_000_000;
	private nextId = 0;
	private readonly timers = new Map<number, {at: number; run: () => void}>();

	now = (): number => this.time;

	setTimeout = (run: () => void, delay: number): (() => void) => {
		const id = ++this.nextId;
		this.timers.set(id, {at: this.time + delay, run});
		return () => {
			this.timers.delete(id);
		};
	};

	advance(milliseconds: number): void {
		const until = this.time + milliseconds;
		for (;;) {
			const due = [...this.timers]
				.filter(([, timer]) => timer.at <= until)
				.sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			const [id, timer] = due;
			this.timers.delete(id);
			this.time = timer.at;
			timer.run();
		}
		this.time = until;
	}

	get pending(): number {
		return this.timers.size;
	}
}
