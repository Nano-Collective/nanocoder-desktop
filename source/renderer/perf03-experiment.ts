// EXPERIMENT ONLY: never merge this module or its callers into a product branch.
function experimentVariant(): 'A' | 'B' {
	return 'A';
}

type Trigger =
	| 'project'
	| 'projects-changed'
	| 'project-removed'
	| 'supervisor';
type Kind =
	| 'capture-start'
	| 'replay-complete'
	| 'prefix-ready'
	| 'controls-usable'
	| 'input-start'
	| 'input-end'
	| 'scroll-start'
	| 'scroll-end'
	| 'frame-first'
	| 'frame-second'
	| 'loop-start'
	| 'loop-end'
	| 'measurements-end'
	| 'recents-trigger'
	| 'recents-suppressed'
	| 'recents-read-start'
	| 'recents-read-resolved'
	| 'recents-react-commit'
	| 'longtask';

interface Timing {
	kind: Kind;
	at: number;
	readId?: number;
	current?: boolean;
	trigger?: Trigger;
	duration?: number;
}

export interface Perf03Snapshot {
	variant: 'A' | 'B';
	captureStart: number;
	measurementEnd: number | null;
	stoppedAt: number;
	longTasksSupported: boolean;
	dropped: number;
	events: Timing[];
}

let observer: PerformanceObserver | undefined;
let events: Timing[] = [];
let active = false;
let captureStart = 0;
let measurementEnd: number | null = null;
let dropped = 0;
let readSequence = 0;
let longTasksSupported = false;

function append(timing: Timing) {
	if (events.length < 4096) events.push(timing);
	else dropped++;
}

function longTasks(entries: PerformanceEntry[]) {
	for (const entry of entries) {
		if (entry.startTime + entry.duration < captureStart) continue;
		append({kind: 'longtask', at: entry.startTime, duration: entry.duration});
	}
}

export const perf03Experiment = {
	begin() {
		observer?.disconnect();
		events = [];
		dropped = 0;
		captureStart = performance.now();
		measurementEnd = null;
		active = true;
		longTasksSupported =
			PerformanceObserver.supportedEntryTypes.includes('longtask');
		if (!longTasksSupported) throw new Error('Long Task API is unavailable');
		observer = new PerformanceObserver(list => longTasks(list.getEntries()));
		observer.observe({type: 'longtask', buffered: true});
		this.mark('capture-start', captureStart);
	},
	mark(
		kind: Kind,
		at = performance.now(),
		detail?: Pick<Timing, 'readId' | 'current' | 'trigger'>,
	) {
		if (active) append({kind, at, ...detail});
	},
	readStart() {
		const readId = ++readSequence;
		this.mark('recents-read-start', performance.now(), {readId});
		return readId;
	},
	suppress(trigger: Trigger) {
		this.mark('recents-trigger', performance.now(), {trigger});
		if (
			active &&
			measurementEnd === null &&
			experimentVariant() === 'B' &&
			(trigger === 'project' || trigger === 'projects-changed')
		) {
			this.mark('recents-suppressed', performance.now(), {trigger});
			return true;
		}
		return false;
	},
	end() {
		measurementEnd = performance.now();
		this.mark('measurements-end', measurementEnd);
	},
	finish(): Perf03Snapshot {
		if (observer) longTasks(observer.takeRecords());
		observer?.disconnect();
		observer = undefined;
		active = false;
		return {
			variant: experimentVariant(),
			captureStart,
			measurementEnd,
			stoppedAt: performance.now(),
			longTasksSupported,
			dropped,
			events: events.slice().sort((a, b) => a.at - b.at),
		};
	},
};

export type Perf03Experiment = typeof perf03Experiment;

if (typeof window !== 'undefined') {
	(
		window as unknown as {__perf03Experiment: Perf03Experiment}
	).__perf03Experiment = perf03Experiment;
}
