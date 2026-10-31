import {EventEmitter} from 'node:events';
import type {CDPSession} from '@playwright/test';
import test from 'ava';
import {E2E_HIDDEN_SWITCH} from '@/main/window-presentation';
import {
	hiddenFrameSinkRequired,
	startHiddenFrameSink,
} from './hidden-frame-sink';

function fixture(fail?: string) {
	const session = new EventEmitter();
	const calls: Array<{method: string; params: unknown}> = [];
	const cdp = Object.assign(session, {
		send: (async (method: string, params: unknown) => {
			calls.push({method, params});
			if (method === fail) throw new Error('closed fixture session');
			return {};
		}) as CDPSession['send'],
	});
	return {cdp, calls};
}

test('only hidden development Linux and Windows runs consume compositor frames', t => {
	for (const platform of ['linux', 'win32'] as const) {
		t.true(hiddenFrameSinkRequired(false, [E2E_HIDDEN_SWITCH], platform));
		t.false(hiddenFrameSinkRequired(true, [E2E_HIDDEN_SWITCH], platform));
		t.false(hiddenFrameSinkRequired(false, [], platform));
		t.false(
			hiddenFrameSinkRequired(false, [`${E2E_HIDDEN_SWITCH}=true`], platform),
		);
	}
	t.false(hiddenFrameSinkRequired(false, [E2E_HIDDEN_SWITCH], 'darwin'));
});

test('hidden frame sink requests only a one-pixel in-memory stream', async t => {
	const {cdp, calls} = fixture();
	const stop = await startHiddenFrameSink(cdp);
	t.deepEqual(calls, [
		{
			method: 'Page.startScreencast',
			params: {format: 'jpeg', quality: 0, maxWidth: 1, maxHeight: 1},
		},
	]);
	await stop();
});

test('frames are acknowledged immediately without reading or retaining image data', async t => {
	const {cdp, calls} = fixture();
	const stop = await startHiddenFrameSink(cdp);
	cdp.emit('Page.screencastFrame', {
		sessionId: 7,
		get data() {
			t.fail('frame image must never be read');
			return 'private fixture pixels';
		},
	});
	t.deepEqual(calls.at(-1), {
		method: 'Page.screencastFrameAck',
		params: {sessionId: 7},
	});
	await stop();
});

test('closing stops the stream once and removes its frame listener', async t => {
	const {cdp, calls} = fixture();
	const stop = await startHiddenFrameSink(cdp);
	t.is(cdp.listenerCount('Page.screencastFrame'), 1);
	await Promise.all([stop(), stop()]);
	t.is(cdp.listenerCount('Page.screencastFrame'), 0);
	t.is(calls.filter(call => call.method === 'Page.stopScreencast').length, 1);
});

test('a rejected start leaves no frame listener behind', async t => {
	const {cdp} = fixture('Page.startScreencast');
	await t.throwsAsync(startHiddenFrameSink(cdp), {
		message: 'closed fixture session',
	});
	t.is(cdp.listenerCount('Page.screencastFrame'), 0);
});

test('closed-session acknowledgements are handled and stop failure removes the listener', async t => {
	const {cdp} = fixture('Page.screencastFrameAck');
	const stop = await startHiddenFrameSink(cdp);
	cdp.emit('Page.screencastFrame', {sessionId: 1});
	await stop();
	t.is(cdp.listenerCount('Page.screencastFrame'), 0);
	const closed = fixture('Page.stopScreencast');
	const stopClosed = await startHiddenFrameSink(closed.cdp);
	await t.throwsAsync(stopClosed(), {message: 'closed fixture session'});
	t.is(closed.cdp.listenerCount('Page.screencastFrame'), 0);
});
