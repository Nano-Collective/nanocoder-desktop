import test from 'ava';
import {
	E2E_HIDDEN_SWITCH,
	hiddenTestWindows,
	presentWindow,
	windowPresentationOptions,
} from './window-presentation';

test('quiet windows require the exact explicit development-only switch', t => {
	t.true(hiddenTestWindows(false, [E2E_HIDDEN_SWITCH]));
	t.false(hiddenTestWindows(false, []));
	t.false(hiddenTestWindows(false, [`${E2E_HIDDEN_SWITCH}=true`]));
});

test('packaged launches ignore the hidden test switch', t => {
	t.false(hiddenTestWindows(true, [E2E_HIDDEN_SWITCH]));
});

test('only hidden development windows disable background throttling', t => {
	t.deepEqual(windowPresentationOptions(false, [E2E_HIDDEN_SWITCH]), {
		hidden: true,
		webPreferences: {backgroundThrottling: false},
	});
});

test('packaged and unswitched windows leave Electron scheduling defaults untouched', t => {
	for (const isPackaged of [true, false]) {
		for (const args of [[], [`${E2E_HIDDEN_SWITCH}=true`]]) {
			t.deepEqual(windowPresentationOptions(isPackaged, args), {
				hidden: false,
				webPreferences: {},
			});
		}
	}
	t.deepEqual(windowPresentationOptions(true, [E2E_HIDDEN_SWITCH]), {
		hidden: false,
		webPreferences: {},
	});
});

test('quiet activation never restores, shows or focuses a native window', t => {
	const calls: string[] = [];
	presentWindow(
		{
			isMinimized: () => {
				calls.push('isMinimized');
				return true;
			},
			restore: () => calls.push('restore'),
			show: () => calls.push('show'),
			focus: () => calls.push('focus'),
		},
		true,
	);
	t.deepEqual(calls, []);
});

test('normal and packaged presentation retains native restore, show and focus', t => {
	for (const minimized of [false, true]) {
		const calls: string[] = [];
		presentWindow(
			{
				isMinimized: () => minimized,
				restore: () => calls.push('restore'),
				show: () => calls.push('show'),
				focus: () => calls.push('focus'),
			},
			hiddenTestWindows(true, [E2E_HIDDEN_SWITCH]),
		);
		t.deepEqual(
			calls,
			minimized ? ['restore', 'show', 'focus'] : ['show', 'focus'],
		);
	}
});
