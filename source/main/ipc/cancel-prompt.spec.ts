import test from 'ava';
import {cancelPromptRequest} from '@/main/ipc/cancel-prompt';
import {handleRequest} from '@/main/ipc/handle-request';

test('refuses extra cancellation fields before invoking the handler', async t => {
	for (const payload of [
		{projectId: 'renderer-selected-project'},
		{sessionId: 'renderer-selected-session'},
		{extra: true},
		null,
		[],
	]) {
		let called = false;
		const result = await handleRequest({
			sender: {url: 'app://renderer/index.html', isMainFrame: true},
			allowedOrigins: ['app://renderer'],
			schema: cancelPromptRequest,
			payload,
			handler: () => {
				called = true;
				return null;
			},
		});
		t.false(result.ok);
		if (!result.ok) t.is(result.error.code, 'VALIDATION');
		t.false(called);
	}
});
