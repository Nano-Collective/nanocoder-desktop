import test from 'ava';
import {redact, StderrRing} from '@/main/nanocoder/stderr-ring';

test('bounds UTF-8 lines and redacts an overlong secret before retaining any chunk', t => {
	const ring = new StderrRing({maxBytes: 24});
	ring.write(`https://${'private'.repeat(800)}@example.com`);
	ring.write('private-tail\nsafe\n');
	t.false(ring.lines().join('\n').includes('private'));
	t.true(Buffer.byteLength(ring.lines().join('')) <= 24);
	t.true(ring.truncated);
	const unicode = new StderrRing({maxBytes: 12});
	unicode.append('😀'.repeat(100));
	t.true(Buffer.byteLength(unicode.lines().join('')) <= 12);
	t.false(unicode.lines().join('').includes('\uFFFD'));
	t.true(unicode.truncated);
});

test('never retains an overlong URL credential whose terminator arrives in a later chunk', t => {
	const ring = new StderrRing();
	ring.write(`https://${'private'.repeat(800)}`);
	t.false(ring.lines().join('\n').includes('private'));
	ring.write('@example.com\nsafe\n');
	t.deepEqual(ring.lines(), ['[overlong stderr line omitted]', 'safe']);
	t.true(ring.truncated);
});

test('redacts common unlabelled OAuth access tokens, refresh tokens and JWTs', t => {
	for (const token of [
		`ya29.${'a'.repeat(32)}`,
		`1//${'b'.repeat(32)}`,
		`eyJhbGciOiJIUzI1NiJ9.${'c'.repeat(32)}.${'d'.repeat(32)}`,
	]) {
		t.is(redact(`failed ${token}`), 'failed [redacted]');
	}
});
