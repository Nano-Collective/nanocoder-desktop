// Takes a reading repeatedly until two in a row agree within `tolerance`, so a figure means the same on a
// busy machine as on a quiet one. It gives up after `maxSamples` and returns the last reading (PERF-09).
export async function settledSample(options: {
	sample(): number;
	wait(ms: number): Promise<void>;
	intervalMs: number;
	tolerance: number;
	maxSamples: number;
}): Promise<number> {
	let previous = options.sample();
	for (let taken = 1; taken < options.maxSamples; taken++) {
		await options.wait(options.intervalMs);
		const current = options.sample();
		const settled =
			previous > 0 &&
			current > 0 &&
			Math.abs(current - previous) / previous <= options.tolerance;
		previous = current;
		if (settled) return current;
	}
	return previous;
}
