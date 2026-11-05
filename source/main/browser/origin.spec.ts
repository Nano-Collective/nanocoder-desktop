import test from 'ava';
import {isLoopbackPage} from '@/main/browser/origin';

test('BRW-03 localhost and loopback pages are allowed over http and https', t => {
	for (const url of [
		'http://localhost:5173/',
		'https://localhost/app',
		'http://127.0.0.1:3000/x?y=1#z',
		'http://127.9.9.9/',
		'http://[::1]:8080/',
		'HTTP://LOCALHOST:3000/',
	])
		t.true(isLoopbackPage(url), url);
});

test('BRW-03/SEC-12 public hosts and look-alikes are refused', t => {
	for (const url of [
		'https://example.com/',
		'http://localhost.evil.com/',
		'http://127.0.0.1.evil.com/',
		'http://evil.com@localhost.evil.com/',
		'http://localhost@evil.com/',
		'http://192.168.1.10/',
		'http://10.0.0.1/',
		'http://0.0.0.0:3000/',
		'http://[::ffff:8.8.8.8]/',
		'http://foo.localhost/',
	])
		t.false(isLoopbackPage(url), url);
});

test('SEC-12 other schemes and malformed values are refused', t => {
	for (const url of [
		'file:///etc/passwd',
		'javascript:alert(1)',
		'data:text/html,<p>x</p>',
		'about:blank',
		'ftp://localhost/',
		'chrome://gpu',
		'app://index.html',
		'view-source:http://localhost/',
		'',
		'localhost:3000',
		'not a url',
		'http://',
	])
		t.false(isLoopbackPage(url), url);
});
