import test from 'ava';
import {clearsConnectAlert} from '@/renderer/connect-alert';

const folder = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

test('a refusal survives the project event for its own folder', t => {
	t.false(clearsConnectAlert(folder, folder));
});

test('a refusal clears when another folder is selected', t => {
	t.true(clearsConnectAlert(folder, other));
});

test('a refusal with no known folder clears on any folder event', t => {
	t.true(clearsConnectAlert(null, folder));
});
