import test from 'ava';
import {fromView} from '@/main/browser/request-owner';

test('BRW-13 a request from the view belongs to it', t => {
	t.true(fromView(7, 7));
});

test('BRW-13 a worker request with no webContents id belongs to the view, so it is held', t => {
	t.true(fromView(undefined, 7));
});

test('BRW-13 a request from another webContents does not belong to the view', t => {
	t.false(fromView(8, 7));
});
