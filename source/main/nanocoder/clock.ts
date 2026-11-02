export interface SupervisorClock {
	now(): number;
	setTimeout(run: () => void, milliseconds: number): () => void;
}

export const systemClock: SupervisorClock = {
	now: () => Date.now(),
	setTimeout: (run, milliseconds) => {
		const timer = setTimeout(run, milliseconds);
		timer.unref();
		return () => clearTimeout(timer);
	},
};
