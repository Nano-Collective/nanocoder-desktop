import test from 'ava';
import {
	createQuitHandler,
	createWindowRequestHandler,
	disposeDesktop,
} from '@/main/lifecycle';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

test('window requests wait for store and IPC readiness and coalesce during startup', t => {
	const calls: string[] = [];
	const windows = createWindowRequestHandler(() => calls.push('window'));
	windows.request();
	windows.request();
	t.deepEqual(calls, []);
	calls.push('store', 'ipc');
	windows.ready();
	t.deepEqual(calls, ['store', 'ipc', 'window']);
	windows.ready();
	t.deepEqual(calls, ['store', 'ipc', 'window']);
});

test('first readiness fulfils initial demand and handles later activations', t => {
	let requests = 0;
	const windows = createWindowRequestHandler(() => requests++);
	windows.ready();
	t.is(requests, 1);
	windows.request();
	t.is(requests, 2);
	windows.request();
	t.is(requests, 3);
});

test('a reentrant window request cannot create another window', t => {
	let requests = 0;
	const windows = createWindowRequestHandler(() => {
		requests++;
		windows.request();
	});
	windows.ready();
	t.is(requests, 1);
	windows.request();
	t.is(requests, 2);
});

test('a failed window request does not block later activations', t => {
	let requests = 0;
	const windows = createWindowRequestHandler(() => {
		if (++requests === 1) throw new Error('fixture window failure');
	});
	t.throws(windows.ready, {message: 'fixture window failure'});
	windows.request();
	t.is(requests, 2);
});

test('window requests are ignored while asynchronous quit disposal runs', async t => {
	let requests = 0;
	const windows = createWindowRequestHandler(() => requests++);
	t.false(windows.stopped);
	windows.ready();
	const started = deferred();
	const cleanup = deferred();
	const quit = deferred();
	const handler = createQuitHandler(async () => {
		started.resolve();
		await cleanup.promise;
	}, quit.resolve);
	windows.stop();
	handler({preventDefault: () => {}});
	await started.promise;
	t.true(windows.stopped);
	windows.request();
	windows.request();
	windows.ready();
	t.is(requests, 1);
	cleanup.resolve();
	await quit.promise;
	windows.request();
	t.is(requests, 1);
});

test('quitting drops window requests queued during startup', t => {
	let requests = 0;
	const windows = createWindowRequestHandler(() => requests++);
	windows.request();
	windows.request();
	windows.stop();
	windows.ready();
	windows.request();
	t.true(windows.stopped);
	t.is(requests, 0);
});

test('readiness cannot restart a stopped window handler even without an initial request', t => {
	let requests = 0;
	const windows = createWindowRequestHandler(() => requests++);
	windows.stop();
	windows.ready();
	windows.stop();
	windows.ready();
	windows.request();
	t.true(windows.stopped);
	t.is(requests, 0);
});

test('disposal keeps the store open until supervisor and connection cleanup finish', async t => {
	const supervisor = deferred();
	const connection = deferred();
	const started = deferred();
	const calls: string[] = [];
	const disposal = disposeDesktop({
		unsubscribe: () => {
			calls.push('unsubscribe');
		},
		cancelPermissions: () => {
			calls.push('cancel');
		},
		supervisor: {
			close: async () => {
				calls.push('supervisor started');
				started.resolve();
				await supervisor.promise;
				calls.push('supervisor finished');
			},
		},
		connection: {
			close: async () => {
				await connection.promise;
				calls.push('connection finished');
			},
		},
		store: {
			close: () => {
				calls.push('store closed');
			},
		},
	});
	await started.promise;
	t.deepEqual(calls, ['unsubscribe', 'cancel', 'supervisor started']);
	supervisor.resolve();
	await supervisor.promise;
	t.false(calls.includes('store closed'));
	connection.resolve();
	await disposal;
	t.deepEqual(calls, [
		'unsubscribe',
		'cancel',
		'supervisor started',
		'supervisor finished',
		'connection finished',
		'store closed',
	]);
});

test('supervisor shutdown can finish metadata writes before the store closes', async t => {
	const started = deferred();
	const stopped = deferred();
	let storeOpen = true;
	let writes = 0;
	const disposal = disposeDesktop({
		cancelPermissions: () => {},
		supervisor: {
			close: async () => {
				started.resolve();
				await stopped.promise;
				t.true(storeOpen);
				writes++;
			},
		},
		store: {
			close: () => {
				storeOpen = false;
			},
		},
	});
	await started.promise;
	t.true(storeOpen);
	stopped.resolve();
	await disposal;
	t.is(writes, 1);
	t.false(storeOpen);
});

test('disposal closes the store even when earlier cleanup fails', async t => {
	const calls: string[] = [];
	const errors = Array.from({length: 5}, () => new Error('fixture failure'));
	const error = await t.throwsAsync(
		disposeDesktop({
			unsubscribe: () => {
				calls.push('unsubscribe');
				throw errors[0];
			},
			cancelPermissions: () => {
				calls.push('cancel');
				throw errors[1];
			},
			supervisor: {
				close: async () => {
					calls.push('supervisor');
					throw errors[2];
				},
			},
			connection: {
				close: () => {
					calls.push('connection');
					throw errors[3];
				},
			},
			store: {
				close: () => {
					calls.push('store');
					throw errors[4];
				},
			},
		}),
		{instanceOf: AggregateError},
	);
	t.deepEqual((error as AggregateError).errors, errors);
	t.deepEqual(calls, [
		'unsubscribe',
		'cancel',
		'supervisor',
		'connection',
		'store',
	]);
});

test('disposal accepts absent resources', async t => {
	await t.notThrowsAsync(disposeDesktop({cancelPermissions: () => {}}));
});

for (const fails of [false, true]) {
	test(`quit waits for disposal and resumes once when disposal ${fails ? 'fails' : 'succeeds'}`, async t => {
		const cleanup = deferred();
		const started = deferred();
		const quit = deferred();
		let disposals = 0;
		let quits = 0;
		let prevented = 0;
		const handler = createQuitHandler(
			async () => {
				disposals++;
				started.resolve();
				await cleanup.promise;
				if (fails) throw new Error('fixture failure');
			},
			() => {
				quits++;
				quit.resolve();
			},
		);
		const event = {
			preventDefault: () => {
				prevented++;
			},
		};
		handler(event);
		handler(event);
		await started.promise;
		t.is(prevented, 2);
		t.is(disposals, 1);
		t.is(quits, 0);
		cleanup.resolve();
		await quit.promise;
		handler(event);
		t.is(prevented, 2);
		t.is(disposals, 1);
		t.is(quits, 1);
	});
}

test('quit resumes if disposal throws before returning a promise', async t => {
	const quit = deferred();
	const handler = createQuitHandler(() => {
		throw new Error('fixture failure');
	}, quit.resolve);
	handler({preventDefault: () => {}});
	await quit.promise;
	t.pass();
});

test('quit resumes on a later event-loop turn even when disposal finishes immediately', async t => {
	const quit = deferred();
	let originalTurn = true;
	setImmediate(() => {
		originalTurn = false;
	});
	const handler = createQuitHandler(
		async () => {},
		() => {
			t.false(originalTurn);
			quit.resolve();
		},
	);
	handler({preventDefault: () => {}});
	await quit.promise;
});
