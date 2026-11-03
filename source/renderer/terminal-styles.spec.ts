import test from 'ava';
import {mirrorStyles} from '@/renderer/terminal-styles';

class Sheet {
	text = '';
	replaceSync(text: string) {
		this.text = text;
	}
}

function setup(initial: Array<{textContent: string | null}> = []) {
	const styles = [...initial];
	const other = new Sheet();
	const host = {
		styles: () => styles,
		adopted: [other] as Sheet[],
		createSheet: () => new Sheet(),
		onChange: undefined as (() => void) | undefined,
		stopped: false,
		watch(onChange: () => void) {
			host.onChange = onChange;
			return () => {
				host.stopped = true;
			};
		},
	};
	return {host, styles, other};
}

test('xterm style elements are applied through adopted sheets, which the strict style policy allows', t => {
	const {host, other} = setup([{textContent: '.a{color:red}'}]);
	mirrorStyles(host);
	t.is(host.adopted.length, 2);
	t.is(host.adopted[0], other);
	t.is(host.adopted[1].text, '.a{color:red}');
});

test('a changed style element updates its sheet in place, and a new one gets its own', t => {
	const first = {textContent: '.a{color:red}'};
	const {host, styles} = setup([first]);
	mirrorStyles(host);
	const sheet = host.adopted[1];
	first.textContent = '.a{color:blue}';
	styles.push({textContent: '.b{color:green}'});
	host.onChange?.();
	t.is(host.adopted[1], sheet);
	t.is(sheet.text, '.a{color:blue}');
	t.is(host.adopted.length, 3);
	t.is(host.adopted[2].text, '.b{color:green}');
});

test('a removed style element drops its sheet and leaves unrelated sheets alone', t => {
	const first = {textContent: '.a{}'};
	const {host, styles, other} = setup([first, {textContent: '.b{}'}]);
	mirrorStyles(host);
	styles.shift();
	host.onChange?.();
	t.is(host.adopted.length, 2);
	t.is(host.adopted[0], other);
	t.is(host.adopted[1].text, '.b{}');
});

test('an empty style element mirrors as an empty sheet', t => {
	const {host} = setup([{textContent: null}]);
	mirrorStyles(host);
	t.is(host.adopted[1].text, '');
});

test('stopping removes every mirrored sheet, stops watching and keeps other sheets', t => {
	const {host, other} = setup([{textContent: '.a{}'}, {textContent: '.b{}'}]);
	const stop = mirrorStyles(host);
	stop();
	t.true(host.stopped);
	t.deepEqual(host.adopted, [other]);
	host.onChange?.();
	t.deepEqual(host.adopted, [other]);
});
