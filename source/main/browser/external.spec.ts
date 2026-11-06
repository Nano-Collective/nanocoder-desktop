import test from 'ava';
import {createExternalOpener} from '@/main/browser/external';

function fixture(approve: boolean) {
	const asked: string[] = [];
	const opened: string[] = [];
	const open = createExternalOpener({
		confirm: async url => {
			asked.push(url);
			return approve;
		},
		open: async url => {
			opened.push(url);
		},
	});
	return {open, asked, opened};
}

test('SEC-16 BRW-09 the user sees the exact address first and it opens only after a yes', async t => {
	const f = fixture(true);
	t.true(await f.open('https://example.com/a?b=1#c'));
	t.deepEqual(f.asked, ['https://example.com/a?b=1#c']);
	t.deepEqual(f.opened, ['https://example.com/a?b=1#c']);
});

test('SEC-16 a refusal opens nothing', async t => {
	const f = fixture(false);
	t.false(await f.open('http://localhost:3000/'));
	t.deepEqual(f.opened, []);
});

test('SEC-16 only http and https addresses are ever handed to the system, and they are not even asked about otherwise', async t => {
	const f = fixture(true);
	for (const url of [
		'file:///etc/passwd',
		'javascript:alert(1)',
		'mailto:a@b.c',
		'ms-msdt:/id',
		'smb://host/share',
		'not a url',
		'',
		'http://user:pass@example.com/',
	])
		await t.throwsAsync(f.open(url), undefined, url);
	t.deepEqual(f.asked, []);
	t.deepEqual(f.opened, []);
});
