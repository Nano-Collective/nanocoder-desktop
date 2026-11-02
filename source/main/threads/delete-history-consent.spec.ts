import test from 'ava';
import {deleteHistoryDialog} from '@/main/threads/delete-history-consent';

test('delete-history confirmation names the root, promises only the saved session and defaults to cancel (CHAT-14)', t => {
	const dialog = deleteHistoryDialog({
		project: {displayName: 'fixture project', canonicalRoot: '/fixture/root'},
		thread: {title: 'fixture thread'},
	});
	t.is(dialog.type, 'warning');
	t.is(dialog.title, 'delete Nanocoder chat history?');
	t.is(dialog.message, 'delete this chat history from Nanocoder?');
	t.true(dialog.detail?.includes('fixture thread · fixture project'));
	t.true(dialog.detail?.includes('/fixture/root'));
	t.true(
		dialog.detail?.includes(
			'deletes the saved Nanocoder session when you confirm',
		),
	);
	t.true(dialog.detail?.includes('if Nanocoder does not offer session/delete'));
	t.true(
		dialog.detail?.includes(
			'removing a thread from the desktop does not do this',
		),
	);
	t.false(dialog.detail?.includes('after separate'));
	t.deepEqual(dialog.buttons, ['delete chat history', 'cancel']);
	t.is(dialog.buttons?.[1], 'cancel');
	t.is(dialog.defaultId, 1);
	t.is(dialog.cancelId, 1);
	t.true(dialog.noLink);
});
