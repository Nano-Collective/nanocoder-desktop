import test from 'ava';
import {SITE_LIMIT, SiteAccess} from '@/main/browser/site-access';

function access(initial: string[] = []) {
	let saved = [...initial];
	const writes: string[][] = [];
	const sites = new SiteAccess({
		get: () => saved,
		set: list => {
			saved = [...list];
			writes.push(saved);
		},
	});
	return {sites, writes, saved: () => saved};
}

test('a site is unknown until the user answers, and answers are kept per chat (DEC-50)', t => {
	const {sites, writes} = access();
	t.is(sites.state('s1', 'https://example.com'), 'unknown');
	sites.allowThread('s1', 'https://example.com');
	t.is(sites.state('s1', 'https://example.com'), 'allowed');
	t.is(sites.state('s2', 'https://example.com'), 'unknown');
	sites.block('s2', 'https://example.com');
	t.is(sites.state('s2', 'https://example.com'), 'blocked');
	t.deepEqual(writes, []);
});

test('always allow is saved, applies to every chat, and a chat block still wins in that chat', t => {
	const {sites, saved} = access();
	sites.block('s1', 'https://docs.example.com');
	sites.allowAlways('https://docs.example.com');
	t.deepEqual(saved(), ['https://docs.example.com']);
	t.is(sites.state('s2', 'https://docs.example.com'), 'allowed');
	t.is(sites.state('s1', 'https://docs.example.com'), 'blocked');
	t.deepEqual(sites.list(), ['https://docs.example.com']);
	sites.allowAlways('https://docs.example.com');
	t.deepEqual(saved(), ['https://docs.example.com']);
});

test('forgetting a saved site asks again next time', t => {
	const {sites, saved} = access(['https://a.example', 'https://b.example']);
	t.true(sites.forget('https://a.example'));
	t.false(sites.forget('https://a.example'));
	t.deepEqual(saved(), ['https://b.example']);
	t.is(sites.state('s1', 'https://a.example'), 'unknown');
});

test('the saved list is bounded, and a site past the limit is allowed for the chat only', t => {
	const many = Array.from(
		{length: SITE_LIMIT},
		(_, i) => `https://s${i}.example`,
	);
	const {sites, saved} = access(many);
	t.false(sites.allowAlways('https://new.example'));
	t.is(saved().length, SITE_LIMIT);
	t.is(sites.state('s1', 'https://new.example'), 'unknown');
});
