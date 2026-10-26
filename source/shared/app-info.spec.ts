import test from 'ava';
import {APP_NAME} from '@/shared/app-info';

test('names the app', t => {
	t.is(APP_NAME, 'Nanocoder Desktop');
});
