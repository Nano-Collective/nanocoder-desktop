import {existsSync} from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {NanocoderFailure} from '@/main/nanocoder/acp-client';
import {
	fakeEvents,
	fakeProject,
	fakeRuntime,
	removeFakeProjects,
} from '@/main/nanocoder/fixtures/fake-project';
import {openProject} from '@/main/nanocoder/open-project';
import type {TrustRefusal} from '@/main/nanocoder/trust';

function open(
	root: string,
	answer: boolean,
	env: NodeJS.ProcessEnv = process.env,
) {
	const asked: TrustRefusal[] = [];
	const outcome = openProject({
		runtime: fakeRuntime,
		root,
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
		env,
		mode: 'normal',
		confirmTrust: async refusal => {
			asked.push(refusal);
			return answer;
		},
	});
	return {asked, outcome};
}

test.after.always(removeFakeProjects);

test('opens a trusted folder without asking', async t => {
	const {asked, outcome} = open(fakeProject(), false);
	const opened = await outcome;
	t.is(opened.status, 'open');
	if (opened.status === 'open') {
		t.deepEqual(opened.session, {id: 'fake-session', mode: 'normal'});
		await opened.connection.close();
	}
	t.deepEqual(asked, []);
});

test('resumes the given session instead of starting a new one', async t => {
	const outcome = await openProject({
		runtime: fakeRuntime,
		root: fakeProject(),
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
		mode: 'normal',
		resumeSessionId: 'fake-session',
		confirmTrust: async () => false,
	});
	t.is(outcome.status, 'open');
	if (outcome.status === 'open') {
		await outcome.connection.close();
		t.deepEqual(outcome.session, {id: 'fake-session', mode: 'normal'});
		t.is(outcome.history.length, 3);
		const methods = fakeEvents(outcome.connection.stderr.lines()).map(
			e => e.method,
		);
		t.true(methods.includes('session/resume'));
		t.false(methods.includes('session/new'));
	}
});

test('a new session has no history', async t => {
	const {outcome} = open(fakeProject(), false);
	const opened = await outcome;
	t.is(opened.status, 'open');
	if (opened.status === 'open') {
		await opened.connection.close();
		t.deepEqual(opened.history, []);
	}
});

test('reports a session that is gone, without asking about trust', async t => {
	const asked: unknown[] = [];
	const error = await openProject({
		runtime: fakeRuntime,
		root: fakeProject(),
		clientInfo: {name: 'nanocoder-desktop', version: '0.0.0-test'},
		mode: 'normal',
		resumeSessionId: 'gone',
		confirmTrust: async refusal => {
			asked.push(refusal);
			return true;
		},
	}).then(
		() => undefined,
		(error: unknown) => error,
	);
	t.true(error instanceof NanocoderFailure);
	t.is((error as NanocoderFailure).code, 'NOT_FOUND');
	t.deepEqual(asked, []);
});

test('asks once, trusts the folder through Nanocoder, then opens it', async t => {
	const root = fakeProject('untrusted');
	const {asked, outcome} = open(root, true, {
		...process.env,
		NANOCODER_TRUST_DIRECTORY: '1',
	});
	const opened = await outcome;
	t.is(asked.length, 1);
	t.is(asked[0].reason, 'not-trusted');
	t.true(existsSync(path.join(root, '.fake-trusted')));
	t.is(opened.status, 'open');
	if (opened.status === 'open') {
		await opened.connection.close();
		const started = fakeEvents(opened.connection.stderr.lines()).find(
			event => event.started,
		);
		t.is(started?.trustEnv, null);
	}
});

test('leaves the folder untrusted when the user says no', async t => {
	const root = fakeProject('untrusted');
	const {asked, outcome} = open(root, false);
	const opened = await outcome;
	t.is(asked.length, 1);
	t.is(opened.status, 'untrusted');
	if (opened.status === 'untrusted') {
		t.regex(opened.message, /^Directory .+ is not trusted\.$/);
	}
	t.false(existsSync(path.join(root, '.fake-trusted')));
});

test('gives the reason when the folder changed since it was trusted', async t => {
	const {asked, outcome} = open(fakeProject('changed'), false);
	await outcome;
	t.is(asked[0]?.reason, 'changed');
});

test('reports a second refusal instead of asking again', async t => {
	const {asked, outcome} = open(fakeProject('refuse'), true);
	const error = await outcome.then(
		() => undefined,
		(error: unknown) => error,
	);
	t.true(error instanceof NanocoderFailure);
	t.regex((error as Error).message, /is not trusted/);
	t.is(asked.length, 1);
});

test('passes other startup failures through without asking', async t => {
	const {asked, outcome} = open(fakeProject('crash'), true);
	await t.throwsAsync(outcome, {
		message: 'Nanocoder stopped before it was ready (exit code 3)',
	});
	t.deepEqual(asked, []);
});

test('closes Nanocoder when the session cannot get its mode', async t => {
	const {outcome} = open(fakeProject('no-normal'), true);
	await t.throwsAsync(outcome, {
		message: 'Nanocoder does not offer the normal mode',
	});
});
