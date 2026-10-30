import test from 'ava';
import {descendantPids} from '@/main/terminal/process-tree';
import {Scrollback} from '@/main/terminal/scrollback';

test('TERM-09 scrollback bounds long lines, line counts and Unicode without disk', t => {
	const buffer = new Scrollback(20, 3);
	buffer.append('first\nsecond\nthird\nfourth');
	t.deepEqual(buffer.snapshot(), {
		output: 'second\nthird\nfourth',
		truncated: true,
	});
	buffer.clear();
	buffer.append(`${'a'.repeat(20)}😀`);
	t.false(/^[\uDC00-\uDFFF]/u.test(buffer.snapshot().output));
	t.true(buffer.snapshot().output.length <= 20);
	buffer.clear();
	t.deepEqual(buffer.snapshot(), {output: '', truncated: false});
});

test('TERM-07 process descendants include nested and detached groups, leaves first', t => {
	t.deepEqual(
		descendantPids(10, '10 1\n11 10\n12 11\n13 1\n14 10\nbad\n15 15'),
		[14, 12, 11, 10],
	);
});
