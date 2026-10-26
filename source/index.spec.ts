import test from 'ava';
import {APP_NAME} from '@/index';

test('names the app', t => {
	t.is(APP_NAME, 'Nanocoder Desktop');
});
