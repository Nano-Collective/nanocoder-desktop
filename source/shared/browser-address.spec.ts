import test from 'ava';
import {addressToUrl} from '@/shared/browser-address';

test('BRW-02 a local address gets http and a bare site gets https', t => {
	t.is(addressToUrl('localhost:5173'), 'http://localhost:5173');
	t.is(addressToUrl('localhost'), 'http://localhost');
	t.is(addressToUrl('127.0.0.1:3000/app'), 'http://127.0.0.1:3000/app');
	t.is(addressToUrl('[::1]:8080'), 'http://[::1]:8080');
	t.is(addressToUrl('example.com'), 'https://example.com');
	t.is(addressToUrl('example.com/a b'), 'https://example.com/a b');
});

test('BRW-02 an explicit scheme is kept so the origin policy can refuse it', t => {
	t.is(addressToUrl('http://localhost:3000/'), 'http://localhost:3000/');
	t.is(addressToUrl('HTTPS://Example.com'), 'HTTPS://Example.com');
	for (const value of [
		'file:///etc/passwd',
		'javascript:alert(1)',
		'data:text/html,x',
		'about:blank',
		'view-source:http://localhost/',
	])
		t.is(addressToUrl(value), value);
});

test('BRW-02 whitespace is trimmed and nothing becomes an address from nothing', t => {
	t.is(addressToUrl('  localhost:3000  '), 'http://localhost:3000');
	t.is(addressToUrl(''), '');
	t.is(addressToUrl('   '), '');
});
