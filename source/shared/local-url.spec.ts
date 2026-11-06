import test from 'ava';
import {findLocalUrls, latestLocalUrl, stripAnsi} from '@/shared/local-url';

const urls = (text: string) => findLocalUrls(text).map(match => match.url);

test('TERM-05 the usual dev server lines yield their localhost address', t => {
	t.deepEqual(urls('  Local:   http://localhost:5173/'), [
		'http://localhost:5173/',
	]);
	t.deepEqual(urls('ready on http://127.0.0.1:3000'), [
		'http://127.0.0.1:3000',
	]);
	t.deepEqual(urls('listening at https://localhost:8443/app?x=1#top'), [
		'https://localhost:8443/app?x=1#top',
	]);
	t.deepEqual(urls('server on http://[::1]:8080/'), ['http://[::1]:8080/']);
	t.deepEqual(urls('http://localhost/'), ['http://localhost/']);
});

test('TERM-05 a bare localhost address with a port gets http, a bare host without one is left alone', t => {
	t.deepEqual(urls('Listening on localhost:3000'), ['http://localhost:3000']);
	t.deepEqual(urls('bound to 127.0.0.1:4000/health'), [
		'http://127.0.0.1:4000/health',
	]);
	t.deepEqual(urls('localhost is my machine'), []);
	t.deepEqual(urls('see mylocalhost:3000 for more'), []);
});

test('TERM-05 trailing punctuation and brackets that are not part of the address are dropped', t => {
	t.deepEqual(urls('open http://localhost:3000/.'), ['http://localhost:3000/']);
	t.deepEqual(urls('(http://localhost:3000/docs)'), [
		'http://localhost:3000/docs',
	]);
	t.deepEqual(urls('see "http://localhost:3000/a", then'), [
		'http://localhost:3000/a',
	]);
	t.deepEqual(urls('go: http://localhost:3000/a?b=1&c=2;'), [
		'http://localhost:3000/a?b=1&c=2',
	]);
	t.deepEqual(urls('http://localhost:3000/wiki_(page) works'), [
		'http://localhost:3000/wiki_(page)',
	]);
});

test('TERM-05 positions point at the address inside the line', t => {
	const text = 'x http://localhost:5173/ y';
	const [match] = findLocalUrls(text);
	t.is(text.slice(match.start, match.end), 'http://localhost:5173/');
});

test('TERM-05 public hosts, look-alikes, credentials and other schemes are never offered', t => {
	for (const text of [
		'http://example.com:3000/',
		'http://localhost.evil.com:3000/',
		'http://localhost.evil.com/',
		'http://127.0.0.1.evil.com/',
		'http://127.300.0.1:3000/',
		'ftp://localhost:21/',
		'http://user:pw@localhost:3000/',
		'http://user@localhost:3000/',
		'http://0.0.0.0:3000/',
		'xhttp://localhost:3000/',
		'http://evil.com/?next=http://localhost:3000/',
		'http://evil.com/localhost:3000/',
		'mailto:me@localhost:3000',
	])
		t.deepEqual(urls(text), [], text);
});

test('TERM-05 an address that follows ordinary words or separators is still found', t => {
	for (const text of [
		'Local:http://localhost:3000/',
		'<http://localhost:3000/>',
		'`http://localhost:3000/`',
		"'http://localhost:3000/'",
		'[http://localhost:3000/]',
		'a,http://localhost:3000/',
	])
		t.deepEqual(urls(text), ['http://localhost:3000/'], text);
});

test('TERM-05 colour codes around an address are ignored when text is cleaned first', t => {
	const raw =
		'\u001b[36m  ➜  Local:\u001b[0m   \u001b[1mhttp://localhost:5173/\u001b[22m';
	t.is(stripAnsi(raw), '  ➜  Local:   http://localhost:5173/');
	t.deepEqual(urls(stripAnsi(raw)), ['http://localhost:5173/']);
	t.is(stripAnsi('\u001b]8;;http://x\u0007link\u001b]8;;\u0007'), 'link');
});

test('TERM-05 the newest address in a stream of output wins and a very long one is refused', t => {
	t.is(
		latestLocalUrl('a http://localhost:3000/ b\nnow http://localhost:3001/'),
		'http://localhost:3001/',
	);
	t.is(latestLocalUrl('nothing here'), null);
	t.is(latestLocalUrl(`http://localhost:3000/${'a'.repeat(3_000)}`), null);
});

test('TERM-05 a huge output is searched from its tail only', t => {
	const text = `http://localhost:1111/ ${'x'.repeat(100_000)} http://localhost:2222/`;
	t.is(latestLocalUrl(text), 'http://localhost:2222/');
	t.is(latestLocalUrl(`http://localhost:1111/ ${'x'.repeat(100_000)}`), null);
});
