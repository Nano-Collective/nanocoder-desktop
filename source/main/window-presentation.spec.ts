import test from 'ava';
import {
	E2E_HIDDEN_SWITCH,
	hiddenTestWindows,
	presentWindow,
} from './window-presentation';

test('quiet windows require the exact explicit development-only switch', t => {
	t.true(hiddenTestWindows(false, [E2E_HIDDEN_SWITCH]));
	t.false(hiddenTestWindows(false, []));
	t.false(hiddenTestWindows(false, [`${E2E_HIDDEN_SWITCH}=true`]));
});

test('packaged launches ignore the hidden test switch', t => {
	t.false(hiddenTestWindows(true, [E2E_HIDDEN_SWITCH]));
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
