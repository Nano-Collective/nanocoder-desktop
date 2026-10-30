import test, {type ExecutionContext} from 'ava';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	createProjectOperations,
	type ProjectOperationLease,
} from '@/main/threads/project-operations';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => {
		resolve = done;
	});
	return {promise, resolve};
}

function fixture() {
	const projects = new Map(
		['project', 'other'].map(id => [
			id,
			{
				canonicalRoot: `/fixture/${id}`,
				sessionCwd: `/fixture/${id}`,
				trusted: true,
			},
		]),
	);
	const threads = new Map<
		string,
		{sessionCwd: string; nanocoderSessionId: string | null}
	>([
		[
			'project/thread',
			{sessionCwd: '/fixture/project', nanocoderSessionId: null},
		],
		[
			'other/thread',
			{sessionCwd: '/fixture/other', nanocoderSessionId: 'saved'},
		],
	]);
	const connections = new Map<string, object>([['project', {}]]);
	const operations = createProjectOperations({
		getProject: id => projects.get(id),
		getThread: (id, threadId) => threads.get(`${id}/${threadId}`),
		getConnection: id => connections.get(id),
	});
	return {operations, projects, threads, connections};
}

function required<K, V>(values: ReadonlyMap<K, V>, key: K): V {
	const value = values.get(key);
	if (value === undefined) throw new Error('Missing fixture value');
	return value;
}

function throwsCode(
	t: ExecutionContext,
	work: () => unknown,
	code: IpcFailure['code'],
) {
	const error = t.throws(work, {instanceOf: IpcFailure});
	t.is(error?.code, code);
}

async function rejectsCode(
	t: ExecutionContext,
	work: Promise<unknown>,
	code: IpcFailure['code'],
) {
	const error = await t.throwsAsync(work, {instanceOf: IpcFailure});
	t.is(error?.code, code);
	return error;
}

test('the project lease refuses a second operation before the first await (CHAT-17)', async t => {
	const {operations} = fixture();
	const held = deferred();
	let secondStarted = false;
	const first = operations.runProjectOperation(
		'project',
		'prompt',
		async () => {
			await held.promise;
		},
	);
	try {
		const error = await t.throwsAsync(
			operations.runProjectOperation('project', 'controls', async () => {
				secondStarted = true;
			}),
			{
				instanceOf: IpcFailure,
			},
		);
		t.is(error?.code, 'BUSY');
		t.true(error?.retryable);
		t.false(secondStarted);
		t.true(operations.isBusy('project'));
	} finally {
		held.resolve();
		await first;
	}
	t.false(operations.isBusy('project'));
	t.false(secondStarted);
});

test('one lease carries first-send preparation, mode and prompt without re-entry', async t => {
	const {operations, connections, threads} = fixture();
	const steps: string[] = [];
	await operations.runProjectOperation(
		'project',
		'prompt',
		async lease => {
			t.true(Object.isFrozen(lease));
			t.is(lease.canonicalRoot, '/fixture/project');
			for (const step of ['new', 'safe-mode', 'save-id', 'yolo', 'prompt']) {
				operations.assertCurrent(lease);
				if (step === 'new')
					operations.bindConnection(lease, required(connections, 'project'));
				if (step === 'save-id') {
					required(threads, 'project/thread').nanocoderSessionId =
						'new-session';
					operations.bindSession(lease, 'new-session');
				}
				steps.push(step);
				await Promise.resolve();
				operations.assertCurrent(lease);
			}
			await rejectsCode(
				t,
				operations.runProjectOperation('project', 'controls', async () => {
					t.fail('Owned helpers must not re-enter');
				}),
				'BUSY',
			);
		},
		{threadId: 'thread'},
	);
	t.deepEqual(steps, ['new', 'safe-mode', 'save-id', 'yolo', 'prompt']);
	t.false(operations.isBusy('project'));
});

test('unrelated projects have independent operation slots', async t => {
	const {operations} = fixture();
	const held = deferred();
	const first = operations.runProjectOperation(
		'project',
		'prompt',
		async () => {
			await held.promise;
		},
	);
	await operations.runProjectOperation('other', 'controls', async lease => {
		t.is(lease.projectId, 'other');
		t.true(operations.isBusy('project'));
		t.true(operations.isBusy('other'));
	});
	t.false(operations.isBusy('other'));
	held.resolve();
	await first;
});

for (const change of ['missing', 'untrusted', 'cwd'] as const) {
	test(`lease acquisition refuses ${change} project ownership before work (SEC-17)`, async t => {
		const {operations, projects} = fixture();
		if (change === 'missing') projects.delete('project');
		if (change === 'untrusted') required(projects, 'project').trusted = false;
		if (change === 'cwd')
			required(projects, 'project').sessionCwd = '/elsewhere';
		await rejectsCode(
			t,
			operations.runProjectOperation('project', 'controls', async () => {
				t.fail('Invalid project must not perform work');
			}),
			change === 'missing' ? 'NOT_FOUND' : 'DENIED',
		);
		t.false(operations.isBusy('project'));
	});
}

test('leases are frozen, authority-bound and invalid after release', async t => {
	const {operations} = fixture();
	const stranger = fixture().operations;
	let old!: ProjectOperationLease;
	await operations.runProjectOperation('project', 'controls', async lease => {
		old = lease;
		t.true(Object.isFrozen(lease));
		t.throws(() => Object.assign(lease, {projectId: 'other'}), {
			instanceOf: TypeError,
		});
		throwsCode(t, () => operations.assertCurrent({...lease}), 'DENIED');
		throwsCode(t, () => stranger.assertCurrent(lease), 'DENIED');
	});
	throwsCode(t, () => operations.assertCurrent(old), 'AGENT_UNAVAILABLE');
	await operations.runProjectOperation('project', 'controls', async lease => {
		t.not(lease, old);
		throwsCode(
			t,
			() => operations.bindThread(old, 'thread'),
			'AGENT_UNAVAILABLE',
		);
		operations.assertCurrent(lease);
		t.true(operations.isBusy('project'));
	});
});

for (const change of ['root', 'cwd', 'trust', 'delete'] as const) {
	test(`a ${change} project change refuses a held lease after an await`, async t => {
		const {operations, projects} = fixture();
		await operations
			.runProjectOperation('project', 'controls', async lease => {
				await Promise.resolve();
				if (change === 'root')
					required(projects, 'project').canonicalRoot = '/new-root';
				if (change === 'cwd')
					required(projects, 'project').sessionCwd = '/new-cwd';
				if (change === 'trust') required(projects, 'project').trusted = false;
				if (change === 'delete') projects.delete('project');
				throwsCode(
					t,
					() => operations.assertCurrent(lease),
					change === 'delete' ? 'NOT_FOUND' : 'DENIED',
				);
			})
			.then(
				() => t.fail('Changed ownership must not return a successful result'),
				error => t.true(error instanceof IpcFailure),
			);
		t.false(operations.isBusy('project'));
	});
}

test('binding refuses unknown, foreign and replaced thread ownership', async t => {
	const {operations, threads} = fixture();
	await operations
		.runProjectOperation('project', 'controls', async lease => {
			throwsCode(t, () => operations.bindThread(lease, 'unknown'), 'NOT_FOUND');
			threads.set('project/foreign', {
				sessionCwd: '/fixture/other',
				nanocoderSessionId: 'foreign',
			});
			throwsCode(t, () => operations.bindThread(lease, 'foreign'), 'DENIED');
			operations.bindThread(lease, 'thread');
			operations.bindThread(lease, 'thread');
			throwsCode(t, () => operations.bindThread(lease, 'foreign'), 'DENIED');
			threads.delete('project/thread');
			throwsCode(t, () => operations.assertCurrent(lease), 'NOT_FOUND');
		})
		.catch(error => t.true(error instanceof IpcFailure));
});

test('binding a first saved ID is explicit and a later replacement is refused', async t => {
	const {operations, threads} = fixture();
	await operations
		.runProjectOperation('project', 'prompt', async lease => {
			throwsCode(t, () => operations.bindSession(lease, 'saved'), 'DENIED');
			operations.bindThread(lease, 'thread');
			required(threads, 'project/thread').nanocoderSessionId = 'saved';
			throwsCode(t, () => operations.assertCurrent(lease), 'DENIED');
			operations.bindSession(lease, 'saved');
			operations.bindSession(lease, 'saved');
			operations.assertCurrent(lease);
			required(threads, 'project/thread').nanocoderSessionId = 'replacement';
			throwsCode(
				t,
				() => operations.bindSession(lease, 'replacement'),
				'DENIED',
			);
		})
		.catch(error => t.true(error instanceof IpcFailure));
});

test('connection identity is bound once and replaced connections refuse further work', async t => {
	const {operations, connections} = fixture();
	await operations
		.runProjectOperation('project', 'controls', async lease => {
			throwsCode(
				t,
				() => operations.bindConnection(lease, {}),
				'AGENT_UNAVAILABLE',
			);
			const connection = required(connections, 'project');
			operations.bindConnection(lease, connection);
			operations.bindConnection(lease, connection);
			connections.set('project', {});
			throwsCode(t, () => operations.assertCurrent(lease), 'AGENT_UNAVAILABLE');
			throwsCode(
				t,
				() =>
					operations.bindConnection(lease, required(connections, 'project')),
				'AGENT_UNAVAILABLE',
			);
		})
		.catch(error => t.true(error instanceof IpcFailure));
});

test('invalidation aborts immediately but keeps BUSY through work and child settlement', async t => {
	const {operations} = fixture();
	const held = deferred();
	const stopped = deferred();
	let lease!: ProjectOperationLease;
	const first = operations.runProjectOperation(
		'project',
		'prompt',
		async owner => {
			lease = owner;
			await held.promise;
		},
	);
	const rejected = rejectsCode(t, first, 'AGENT_UNAVAILABLE');
	operations.invalidate('project', stopped.promise);
	t.true(lease.signal.aborted);
	await rejectsCode(
		t,
		operations.runProjectOperation('project', 'controls', async () => {
			t.fail('Invalidation cannot unlock before shutdown');
		}),
		'BUSY',
	);
	held.resolve();
	await Promise.resolve();
	t.true(operations.isBusy('project'));
	stopped.resolve();
	await rejected;
	t.false(operations.isBusy('project'));
	await operations.runProjectOperation('project', 'controls', async next => {
		t.true(next.epoch > lease.epoch);
		throwsCode(t, () => operations.assertCurrent(lease), 'AGENT_UNAVAILABLE');
		operations.assertCurrent(next);
	});
});

test('invalidation does not release while work still owns a stopped child', async t => {
	const {operations} = fixture();
	const held = deferred();
	const first = operations.runProjectOperation(
		'project',
		'prompt',
		async () => {
			await held.promise;
		},
	);
	const rejected = rejectsCode(t, first, 'AGENT_UNAVAILABLE');
	operations.invalidate('project', Promise.resolve());
	await Promise.resolve();
	t.true(operations.isBusy('project'));
	held.resolve();
	await rejected;
});

test('thread invalidation aborts only the exact bound thread', async t => {
	const {operations} = fixture();
	await operations
		.runProjectOperation('project', 'controls', async lease => {
			operations.bindThread(lease, 'thread');
			operations.invalidateThread('other', 'thread');
			operations.invalidateThread('project', 'unrelated');
			t.false(lease.signal.aborted);
			operations.assertCurrent(lease);
			operations.invalidateThread('project', 'thread');
			t.true(lease.signal.aborted);
		})
		.then(
			() => t.fail('Removed thread must not complete'),
			error => t.is(error.code, 'AGENT_UNAVAILABLE'),
		);
});

test('abort reasons stay sanitised and an aborted owner does not unlock early', async t => {
	const {operations} = fixture();
	const controller = new AbortController();
	const held = deferred();
	let lease!: ProjectOperationLease;
	const first = operations.runProjectOperation(
		'project',
		'controls',
		async owner => {
			lease = owner;
			await held.promise;
		},
		{signal: controller.signal},
	);
	const rejected = rejectsCode(t, first, 'AGENT_UNAVAILABLE');
	controller.abort(new Error('secret fixture reason'));
	t.true(lease.signal.aborted);
	t.true(operations.isBusy('project'));
	held.resolve();
	const error = await rejected;
	t.false(error?.message.includes('secret'));
});

test('an already aborted scope performs no work or reservation', async t => {
	const {operations} = fixture();
	const controller = new AbortController();
	controller.abort();
	await rejectsCode(
		t,
		operations.runProjectOperation(
			'project',
			'prompt',
			async () => {
				t.fail('Aborted work must not start');
			},
			{signal: controller.signal},
		),
		'AGENT_UNAVAILABLE',
	);
	t.false(operations.isBusy('project'));
});

test('cleanup includes settlements added during earlier cleanup and observes failures', async t => {
	const {operations} = fixture();
	const held = deferred();
	const firstStop = deferred();
	const secondStop = deferred();
	const first = operations.runProjectOperation(
		'project',
		'prompt',
		async () => {
			await held.promise;
		},
	);
	const rejected = rejectsCode(t, first, 'AGENT_UNAVAILABLE');
	operations.invalidate('project', firstStop.promise);
	held.resolve();
	await Promise.resolve();
	operations.invalidate('project', secondStop.promise);
	firstStop.resolve();
	await Promise.resolve();
	t.true(operations.isBusy('project'));
	operations.invalidate(
		'project',
		Promise.reject(new Error('fixture stop failed')),
	);
	secondStop.resolve();
	await rejected;
	t.false(operations.isBusy('project'));
});

test('normal and rejected work release ownership without a queued mutation', async t => {
	const {operations} = fixture();
	const error = new IpcFailure('UNSUPPORTED', 'fixture refusal');
	t.is(
		await t.throwsAsync(
			operations.runProjectOperation('project', 'controls', async () => {
				throw error;
			}),
		),
		error,
	);
	t.false(operations.isBusy('project'));
	t.is(
		await operations.runProjectOperation('project', 'controls', async () => 7),
		7,
	);
});

test('disposal aborts all owners and refuses new operations without waiting to invalidate', async t => {
	const {operations} = fixture();
	const held = deferred();
	const leases: ProjectOperationLease[] = [];
	const tasks = ['project', 'other'].map(id => {
		const task = operations.runProjectOperation(id, 'prompt', async lease => {
			leases.push(lease);
			await held.promise;
		});
		return rejectsCode(t, task, 'AGENT_UNAVAILABLE');
	});
	operations.dispose();
	operations.dispose();
	t.true(leases.every(lease => lease.signal.aborted));
	t.true(operations.isBusy('project'));
	await rejectsCode(
		t,
		operations.runProjectOperation('unknown', 'controls', async () => {
			t.fail('Disposed authority must not work');
		}),
		'AGENT_UNAVAILABLE',
	);
	held.resolve();
	await Promise.all(tasks);
	t.false(operations.isBusy('project'));
	t.false(operations.isBusy('other'));
});

test('an owned step refuses a released lease before invoking privileged work', async t => {
	const {operations} = fixture();
	let old!: ProjectOperationLease;
	await operations.runProjectOperation('project', 'controls', async lease => {
		old = lease;
	});
	let called = false;
	await rejectsCode(
		t,
		operations.runOwnedStep(old, async () => {
			called = true;
		}),
		'AGENT_UNAVAILABLE',
	);
	t.false(called);
});

test('an owned step checks ownership after its asynchronous response', async t => {
	const {operations, connections} = fixture();
	await operations
		.runProjectOperation('project', 'controls', async lease => {
			operations.bindConnection(lease, required(connections, 'project'));
			await rejectsCode(
				t,
				operations.runOwnedStep(lease, async () => {
					await Promise.resolve();
					connections.set('project', {});
					return 'stale config';
				}),
				'AGENT_UNAVAILABLE',
			);
		})
		.then(
			() => t.fail('A replaced connection must not return success'),
			error => t.is(error.code, 'AGENT_UNAVAILABLE'),
		);
});

test('active-turn cancellation settlement holds the same lease without invalidating it', async t => {
	const {operations} = fixture();
	const prompt = deferred();
	const promptReturned = deferred();
	const cancelled = deferred();
	let lease!: ProjectOperationLease;
	const first = operations.runProjectOperation(
		'project',
		'prompt',
		async owner => {
			lease = owner;
			await prompt.promise;
			promptReturned.resolve();
			return 'cancelled';
		},
	);
	const cancel = operations.runOwnedStep(lease, () => cancelled.promise);
	prompt.resolve();
	await promptReturned.promise;
	await Promise.resolve();
	t.true(operations.isBusy('project'));
	t.false(lease.signal.aborted);
	await rejectsCode(
		t,
		operations.runProjectOperation('project', 'controls', async () => {
			t.fail('Cancellation settlement must not permit a control mutation');
		}),
		'BUSY',
	);
	cancelled.resolve();
	await cancel;
	t.is(await first, 'cancelled');
	t.false(operations.isBusy('project'));
});

test('a released scope abort cannot invalidate a replacement owner', async t => {
	const {operations} = fixture();
	const controller = new AbortController();
	await operations.runProjectOperation('project', 'controls', async () => {}, {
		signal: controller.signal,
	});
	await operations.runProjectOperation('project', 'controls', async lease => {
		controller.abort();
		operations.assertCurrent(lease);
		t.false(lease.signal.aborted);
	});
});
