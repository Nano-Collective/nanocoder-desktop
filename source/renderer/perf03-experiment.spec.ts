import test from 'ava';
import {perf03Experiment} from './perf03-experiment';

test('experiment records bounded numeric timing only and drains its long-task observer', t => {
	const previous = Object.getOwnPropertyDescriptor(
		globalThis,
		'PerformanceObserver',
	);
	let deliver!: (list: {getEntries(): PerformanceEntry[]}) => void;
	let disconnected = 0;
	class Observer {
		static supportedEntryTypes = ['longtask'];
		constructor(callback: typeof deliver) {
			deliver = callback;
		}
		observe() {}
		takeRecords() {
			return [];
		}
		disconnect() {
			disconnected++;
		}
	}
	Object.defineProperty(globalThis, 'PerformanceObserver', {
		configurable: true,
		value: Observer,
	});
	try {
		perf03Experiment.begin();
		deliver({
			getEntries: () =>
				[
					{startTime: 0, duration: 1, name: 'before capture'},
					{
						startTime: performance.now(),
						duration: 60,
						name: 'must not log task names or attribution',
						attribution: [{containerSrc: 'private fixture content'}],
					},
				] as unknown as PerformanceEntry[],
		});
		t.false(perf03Experiment.suppress('project'));
		perf03Experiment.end();
		const snapshot = perf03Experiment.finish();
		t.true(snapshot.longTasksSupported);
		t.is(snapshot.variant, 'A');
		t.is(disconnected, 1);
		const tasks = snapshot.events.filter(event => event.kind === 'longtask');
		t.is(tasks.length, 1);
		t.deepEqual(Object.keys(tasks[0]).sort(), ['at', 'duration', 'kind']);
		t.false(JSON.stringify(snapshot).includes('private fixture content'));
		perf03Experiment.begin();
		for (let i = 0; i < 4200; i++) perf03Experiment.mark('input-start', i);
		const bounded = perf03Experiment.finish();
		t.is(bounded.events.length, 4096);
		t.true(bounded.dropped > 0);
		perf03Experiment.mark('input-end');
		t.is(perf03Experiment.finish().events.length, 4096);
	} finally {
		if (previous)
			Object.defineProperty(globalThis, 'PerformanceObserver', previous);
		else Reflect.deleteProperty(globalThis, 'PerformanceObserver');
	}
});
