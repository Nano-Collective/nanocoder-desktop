import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	APP_ORIGIN,
	contentSecurityPolicy,
	isAllowedOrigin,
	resolveRendererFile,
} from '@/main/security';

const work = realpathSync(mkdtempSync(path.join(tmpdir(), 'nd-renderer-')));
const root = path.join(work, 'renderer');
for (const name of [
	'index.html',
	'assets/index.js',
	'main/index.js',
	'..tools/index.js',
]) {
	const file = path.join(root, name);
	mkdirSync(path.dirname(file), {recursive: true});
	writeFileSync(file, '');
}
test.after.always(() => rmSync(work, {recursive: true, force: true}));

test('allows navigation within the app origin', t => {
	t.true(isAllowedOrigin('app://renderer/index.html', [APP_ORIGIN]));
});

test('refuses navigation to other origins', t => {
	t.false(isAllowedOrigin('https://example.com/', [APP_ORIGIN]));
	t.false(isAllowedOrigin('file:///etc/passwd', [APP_ORIGIN]));
	t.false(isAllowedOrigin('app://other/index.html', [APP_ORIGIN]));
});

test('refuses malformed navigation targets', t => {
	t.false(isAllowedOrigin('not a url', [APP_ORIGIN]));
});

test('allows the development server origin when it is listed', t => {
	t.true(isAllowedOrigin('http://localhost:5173/', ['http://localhost:5173']));
});

test('maps the root and files to the renderer folder', t => {
	t.is(
		resolveRendererFile('app://renderer/', root),
		path.join(root, 'index.html'),
	);
	t.is(
		resolveRendererFile('app://renderer/assets/index.js', root),
		path.join(root, 'assets', 'index.js'),
	);
});

test('keeps dot segments the URL parser resolves inside the folder', t => {
	t.is(
		resolveRendererFile('app://renderer/%2e%2e/main/index.js', root),
		path.join(root, 'main', 'index.js'),
	);
});

test('refuses requests that leave the renderer folder', t => {
	t.is(resolveRendererFile('app://renderer/..%2f..%2fsecret', root), null);
	t.is(resolveRendererFile('app://renderer/..%5c..%5csecret', root), null);
	t.is(
		resolveRendererFile('app://renderer/..%2frenderer-other/secret', root),
		null,
	);
	t.is(resolveRendererFile('app://renderer/missing.js', root), null);
});

test('a two-dot-prefixed renderer directory remains inside its root', t => {
	t.is(
		resolveRendererFile('app://renderer/..tools/index.js', root),
		path.join(root, '..tools/index.js'),
	);
});

const symlinkTest = process.platform === 'win32' ? test.skip : test;
symlinkTest(
	'renderer file resolution checks the canonical target it returns',
	t => {
		const outside = path.join(work, 'renderer-other');
		mkdirSync(outside);
		writeFileSync(path.join(outside, 'secret'), '');
		symlinkSync(outside, path.join(root, 'escape'), 'dir');
		symlinkSync(path.join(root, 'assets'), path.join(root, 'inside'), 'dir');
		t.is(resolveRendererFile('app://renderer/escape/secret', root), null);
		t.is(
			resolveRendererFile('app://renderer/inside/index.js', root),
			path.join(root, 'assets/index.js'),
		);
	},
);

test('refuses other hosts, schemes and malformed requests', t => {
	t.is(resolveRendererFile('app://other/index.html', root), null);
	t.is(resolveRendererFile('file:///etc/passwd', root), null);
	t.is(resolveRendererFile('app://renderer/%E0%A4%A', root), null);
	t.is(resolveRendererFile('app://renderer/a%00b', root), null);
	t.is(resolveRendererFile('not a url', root), null);
});

test('the production policy blocks inline scripts and remote content', t => {
	const policy = contentSecurityPolicy();
	t.true(policy.includes("default-src 'none'"));
	t.true(policy.includes("script-src 'self'"));
	t.false(policy.includes('unsafe-inline'));
	// nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
	t.false(policy.includes('ws://'));
});

test('the development policy allows only the dev server websocket', t => {
	const policy = contentSecurityPolicy('http://localhost:5173');
	t.true(policy.includes("connect-src 'self' ws://localhost:5173"));
	t.true(policy.includes("script-src 'self'"));
});
