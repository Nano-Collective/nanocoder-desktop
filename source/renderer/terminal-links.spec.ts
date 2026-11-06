import test from 'ava';
import {type LinkLine, terminalLinks} from '@/renderer/terminal-links';

function line(text: string, wrapped = false): LinkLine {
	const cells: Array<{chars: string; width: number}> = [];
	for (const char of text) {
		const wide = (char.codePointAt(0) ?? 0) > 0x2e80;
		cells.push({chars: char, width: wide ? 2 : 1});
		if (wide) cells.push({chars: '', width: 0});
	}
	return {
		length: cells.length + 4,
		isWrapped: wrapped,
		getCell: x =>
			x < cells.length
				? {getChars: () => cells[x].chars, getWidth: () => cells[x].width}
				: {getChars: () => '', getWidth: () => 1},
	};
}

test('TERM-05 a link gets the one-based columns of its address', t => {
	const [link] = terminalLinks(
		line('  Local: http://localhost:5173/'),
		undefined,
	);
	t.is(link.url, 'http://localhost:5173/');
	t.is(link.startX, 10);
	t.is(link.endX, 31);
});

test('TERM-05 wide characters before an address shift its columns, not its text', t => {
	const [link] = terminalLinks(line('漢字 http://localhost:3000/'), undefined);
	t.is(link.url, 'http://localhost:3000/');
	t.is(link.startX, 6);
	t.is(link.endX, 6 + 'http://localhost:3000/'.length - 1);
});

test('TERM-05 an address cut by the end of the row and continued on the next is not linked', t => {
	t.deepEqual(
		terminalLinks(line('see http://localhost:5173/pa'), line('th/more', true)),
		[],
	);
});

test('TERM-05 an address that ends before the row ends is linked even when the next row is a continuation', t => {
	const links = terminalLinks(
		line('go http://localhost:5173/ now and then more words'),
		line('tail of the sentence', true),
	);
	t.deepEqual(
		links.map(link => link.url),
		['http://localhost:5173/'],
	);
});

test('TERM-05 the start of a continuation row is not linked, since its beginning is on the row above', t => {
	t.deepEqual(terminalLinks(line('localhost:3000/rest', true), undefined), []);
	t.deepEqual(
		terminalLinks(line('x localhost:3000/rest', true), undefined).map(
			link => link.url,
		),
		['http://localhost:3000/rest'],
	);
});

test('TERM-05 an empty or missing row has no links', t => {
	t.deepEqual(terminalLinks(undefined, undefined), []);
	t.deepEqual(terminalLinks(line(''), undefined), []);
});
