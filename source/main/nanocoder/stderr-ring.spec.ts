import test from 'ava';
import {redact, StderrRing} from '@/main/nanocoder/stderr-ring';

const cases: Array<[string, string]> = [
	[
		'fetch https://user:hunter2@example.com/v1 failed',
		'fetch https://[redacted]@example.com/v1 failed',
	],
	['Authorization: Bearer abc.def-ghi', 'Authorization: [redacted]'],
	['{"authorization":"Basic dXNlcjpwYXNz"}', '{"authorization":"[redacted]"}'],
	['retrying with bearer abc123', 'retrying with Bearer [redacted]'],
	[
		'OPENAI_API_KEY=abc123 node cli.js',
		'OPENAI_API_KEY=[redacted] node cli.js',
	],
	['{"apiKey": "abc123"}', '{"apiKey": "[redacted]"}'],
	['GET /v1?token=abc123&page=2', 'GET /v1?token=[redacted]&page=2'],
	['password: hunter2', 'password: [redacted]'],
	['key sk-ant-api03-abcdefghijklmnop rejected', 'key [redacted] rejected'],
	['ghp_abcdefghijklmnopqrstuvwxyz0123 expired', '[redacted] expired'],
	['github_pat_abcdefghijklmnopqrstuvwxyz', '[redacted]'],
	[`aws ${['AKIA', 'ABCDEFGHIJKLMNOP'].join('')}`, 'aws [redacted]'],
	['AIzaabcdefghijklmnopqrstuvwxyz012345678', '[redacted]'],
];

for (const [input, expected] of cases) {
	test(`redacts ${JSON.stringify(input)}`, t => {
		t.is(redact(input), expected);
	});
}

test('leaves ordinary text alone', t => {
	const line = 'Directory /tmp/project is not trusted. Pass --trust-directory.';
	t.is(redact(line), line);
});

test('replaces the home directory', t => {
	t.is(
		redact('open /home/sam/project/a.ts', '/home/sam', 'linux'),
		'open ~/project/a.ts',
	);
	t.is(
		redact('open /HOME/sam/a.ts', '/home/sam', 'linux'),
		'open /HOME/sam/a.ts',
	);
	t.is(
		redact('open C:\\USERS\\Sam\\a.ts', 'C:\\Users\\Sam', 'win32'),
		'open ~\\a.ts',
	);
});

test('replaces every spelling of the home directory where case is ignored', t => {
	t.is(
		redact('/Users/Sam/a and /users/sam/b', '/Users/Sam', 'darwin'),
		'~/a and ~/b',
	);
});

test('still ignores case when the line holds a character that lowercases longer', t => {
	t.is(redact('/users/sam/İ', '/Users/Sam', 'darwin'), '~/İ');
	t.is(redact('İ /USERS/SAM/a', '/Users/Sam', 'win32'), 'İ ~/a');
	t.is(redact('/home/İsam/x /HOME/İSAM/y', '/home/İsam', 'win32'), '~/x ~/y');
});

test('matches the home directory exactly where case matters', t => {
	t.is(
		redact('/home/sam/a /HOME/SAM/b', '/home/sam', 'linux'),
		'~/a /HOME/SAM/b',
	);
});

test('ignores a root home directory', t => {
	t.is(redact('/etc/hosts', '/', 'linux'), '/etc/hosts');
});

test('joins lines split across chunks before redacting', t => {
	const ring = new StderrRing();
	ring.write('Authorization: Bearer abc');
	ring.write('def\nnext line\n\n');
	t.deepEqual(ring.lines(), ['Authorization: [redacted]', 'next line']);
});

test('keeps a trailing partial line on flush', t => {
	const ring = new StderrRing();
	ring.write('first\r\nlast');
	t.deepEqual(ring.lines(), ['first']);
	ring.flush();
	t.deepEqual(ring.lines(), ['first', 'last']);
});

test('drops the oldest lines past the size bound', t => {
	const ring = new StderrRing({maxBytes: 20});
	for (const line of ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc']) {
		ring.append(line);
	}
	t.deepEqual(ring.lines(), ['bbbbbbbbbb', 'cccccccccc']);
});

test('truncates a long line, even without a newline', t => {
	const ring = new StderrRing();
	ring.write('x'.repeat(5000));
	const [line] = ring.lines();
	t.is(line, `${'x'.repeat(4096)} [truncated]`);
});

test('returns a copy of its lines', t => {
	const ring = new StderrRing();
	ring.append('one');
	(ring.lines() as string[]).push('two');
	t.deepEqual(ring.lines(), ['one']);
});
