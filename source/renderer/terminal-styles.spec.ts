import test from 'ava';
import {mirrorStyles, touchesStyle} from '@/renderer/terminal-styles';

class Sheet {
	text = '';
	writes = 0;
	replaceSync(text: string) {
		this.text = text;
		this.writes += 1;
	}
}

function setup(initial: Array<{textContent: string | null}> = []) {
	const styles = [...initial];
	const other = new Sheet();
	let adopted = [other] as Sheet[];
	const host = {
		styles: () => styles,
		assignments: 0,
		get adopted() {
			return adopted;
		},
		set adopted(sheets: Sheet[]) {
			host.assignments += 1;
			adopted = sheets;
		},
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

test('output writes that change no style leave the sheets and the document alone', t => {
	const first = {textContent: '.a{color:red}'};
	const {host} = setup([first]);
	mirrorStyles(host);
	const sheet = host.adopted[1];
	const assignments = host.assignments;
	const writes = sheet.writes;
	host.onChange?.();
	host.onChange?.();
	t.is(sheet.writes, writes);
	t.is(host.assignments, assignments);
	first.textContent = '.a{color:blue}';
	host.onChange?.();
	t.is(sheet.writes, writes + 1);
	t.is(host.assignments, assignments, 'the set of sheets did not change');
});

test('only changes that involve a style element are worth re-reading', t => {
	const style = {nodeName: 'STYLE'};
	const row = {nodeName: 'DIV', parentNode: {nodeName: 'DIV'}};
	const none: never[] = [];
	t.false(
		touchesStyle({
			target: row,
			addedNodes: [{nodeName: 'SPAN'}],
			removedNodes: none,
		}),
	);
	t.true(touchesStyle({target: style, addedNodes: none, removedNodes: none}));
	t.true(
		touchesStyle({
			target: {nodeName: '#text', parentNode: style},
			addedNodes: none,
			removedNodes: none,
		}),
	);
	t.true(touchesStyle({target: row, addedNodes: [style], removedNodes: none}));
	t.true(touchesStyle({target: row, addedNodes: none, removedNodes: [style]}));
});
