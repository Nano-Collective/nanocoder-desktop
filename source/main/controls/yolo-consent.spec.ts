import test from 'ava';
import type {MessageBoxOptions} from 'electron';
import {confirmYolo} from '@/main/controls/yolo-consent';

test('main-owned yolo confirmation defaults and Escape both cancel and explain the pending scope (DEC-31)', async t => {
	let shown: MessageBoxOptions | undefined;
	const accepted = await confirmYolo({
		project: {displayName: 'fixture project'},
		thread: {title: 'fixture thread', nanocoderSessionId: null},
		ask: async options => {
			shown = options;
			return 1;
		},
	});
	t.true(accepted);
	t.is(shown?.type, 'warning');
	t.deepEqual(shown?.buttons, ['cancel', 'use yolo']);
	t.is(shown?.defaultId, 0);
	t.is(shown?.cancelId, 0);
	t.true(shown?.noLink);
	t.true(
		shown?.detail?.includes('no session is created until the first message'),
	);
	t.true(shown?.detail?.includes('not restored after resume or restart'));
	t.true(shown?.detail?.includes('project default'));
	t.true(shown?.detail?.includes('alwaysAllow'));
	t.true(shown?.message.includes('fixture thread'));
	t.true(shown?.message.includes('fixture project'));
});

test('only an explicit native acceptance is true, never cancellation, Escape or a malformed response (DEC-31)', async t => {
	for (const response of [0, -1, 2, undefined, '1']) {
		t.false(
			await confirmYolo({
				project: {displayName: 'fixture'},
				thread: {title: 'fixture', nanocoderSessionId: 'session'},
				ask: async () => response as number,
			}),
		);
	}
});
