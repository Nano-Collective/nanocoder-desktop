import test from 'ava';
import {
	checkPage,
	isLoopbackPage,
	pageOrigin,
	pageSecurity,
} from '@/main/browser/origin';

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

test('BRW-03 public sites are refused until public browsing is on, loopback never needs it', t => {
	const off = {publicSites: false};
	const on = {publicSites: true};
	t.deepEqual(checkPage('http://localhost:5173/', off), {
		allowed: true,
		local: true,
	});
	t.deepEqual(checkPage('https://example.com/a?b=1', off), {
		allowed: false,
		reason: 'public-off',
	});
	t.deepEqual(checkPage('https://example.com/a?b=1', on), {
		allowed: true,
		local: false,
	});
	t.deepEqual(checkPage('http://localhost.evil.com/', off), {
		allowed: false,
		reason: 'public-off',
	});
});

test('SEC-12 other schemes, credentials and malformed values are refused even with public browsing on', t => {
	const on = {publicSites: true};
	for (const url of [
		'file:///etc/passwd',
		'javascript:alert(1)',
		'data:text/html,<p>x</p>',
		'about:blank',
		'ftp://example.com/',
		'chrome://gpu',
		'app://index.html',
		'view-source:https://example.com/',
	])
		t.deepEqual(checkPage(url, on), {allowed: false, reason: 'scheme'}, url);
	for (const url of [
		'https://user:pass@example.com/',
		'http://user@localhost:3000/',
		'',
		'not a url',
		'http://',
	])
		t.deepEqual(checkPage(url, on), {allowed: false, reason: 'invalid'}, url);
});

test('BRW-04 the origin and security of a page are derived from its URL only', t => {
	t.is(pageOrigin('http://localhost:5173/a/b?c#d'), 'http://localhost:5173');
	t.is(pageOrigin('https://example.com/x'), 'https://example.com');
	t.is(pageOrigin('not a url'), null);
	t.is(pageOrigin('data:text/html,x'), null);
	t.is(pageSecurity('http://localhost:5173/'), 'local');
	t.is(pageSecurity('http://127.0.0.1:3000/'), 'local');
	t.is(pageSecurity('https://example.com/'), 'secure');
	t.is(pageSecurity('http://example.com/'), 'insecure');
	t.is(pageSecurity('file:///x'), null);
});
