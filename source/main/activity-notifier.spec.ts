import test from 'ava';
import {createActivityNotifier} from '@/main/activity-notifier';
import type {ProjectActivityStatus} from '@/shared/ipc';

function fixture(
	options: {supported?: boolean; focused?: boolean; active?: string} = {},
) {
	const shown: Array<{title: string; body: string}> = [];
	const opened: string[] = [];
	let click: (() => void) | undefined;
	const notify = createActivityNotifier({
		supported: () => options.supported ?? true,
		windowFocused: () => options.focused ?? false,
		active: () => options.active ?? 'a',
		projectName: id => (id === 'b' ? 'api' : undefined),
		show: (notification, onClick) => {
			shown.push(notification);
			click = onClick;
		},
		open: id => opened.push(id),
	});
	const change = (status: ProjectActivityStatus, projectId = 'b') =>
		notify({projectId, previous: 'running', status});
	return {shown, opened, change, click: () => click?.()};
}

test('CHAT-22 a background project that needs approval, finishes or fails sends a generic notification', t => {
	const f = fixture();
	f.change('needs-approval');
	f.change('finished');
	f.change('failed');
	t.deepEqual(
		f.shown.map(item => item.body),
		[
			'api is waiting for your approval',
			'api has finished',
			'api stopped with an error',
		],
	);
	t.true(f.shown.every(item => item.title === 'Nanocoder'));
});

test('CHAT-22 running and idle changes, the viewed project and a focused window stay quiet', t => {
	const quiet = fixture();
	quiet.change('running');
	quiet.change('idle');
	quiet.change('needs-approval', 'a');
	t.deepEqual(quiet.shown, []);
	const focused = fixture({focused: true});
	focused.change('needs-approval');
	t.deepEqual(focused.shown, []);
	const unsupported = fixture({supported: false});
	unsupported.change('needs-approval');
	t.deepEqual(unsupported.shown, []);
});

test('CHAT-22 the text carries only the project name, never a command, file or message', t => {
	const f = fixture();
	f.change('needs-approval');
	t.regex(f.shown[0].body, /^api is waiting for your approval$/);
	const nameless = fixture();
	nameless.change('finished', 'unknown');
	t.is(nameless.shown[0].body, 'A project has finished');
});

test('CHAT-22 a long project name is shortened', t => {
	const shown: string[] = [];
	const notify = createActivityNotifier({
		supported: () => true,
		windowFocused: () => false,
		active: () => 'a',
		projectName: () => 'x'.repeat(200),
		show: notification => shown.push(notification.body),
		open: () => undefined,
	});
	notify({projectId: 'b', previous: 'running', status: 'finished'});
	t.true(shown[0].length < 100);
});

test('CHAT-22 clicking the notification opens that project', t => {
	const f = fixture();
	f.change('failed');
	f.click();
	t.deepEqual(f.opened, ['b']);
});
