import test from 'ava';
import {BrowserProfiles, type ProfileData} from '@/main/browser/profiles';

const one = '4f6c1f0e-3a55-4a0b-9d1e-0a2b3c4d5e6f';
const two = '9b1d2c3e-4f50-4a6b-8c7d-1e2f3a4b5c6d';
const code = (error: unknown) => (error as {code?: string}).code;

function fixture() {
	let data: ProfileData = {profiles: [], assignments: {}};
	let writes = 0;
	const profiles = new BrowserProfiles({
		get: () => structuredClone(data),
		set: next => {
			writes++;
			data = structuredClone(next);
		},
	});
	return {profiles, data: () => data, writes: () => writes};
}

test('BRW-05 a new project starts on its own persistent profile', t => {
	const f = fixture();
	t.deepEqual(f.profiles.resolve(one), {kind: 'project'});
});

test('BRW-05 profiles are created with a trimmed unique name and a generated id', t => {
	const f = fixture();
	const made = f.profiles.create('  Work sites ');
	t.is(made.name, 'Work sites');
	t.regex(made.id, /^[0-9a-f-]{36}$/);
	t.deepEqual(f.profiles.list(), [made]);
	for (const name of ['', '   ', 'x'.repeat(41), 'bad\nname'])
		t.is(code(t.throws(() => f.profiles.create(name))), 'VALIDATION');
	t.is(code(t.throws(() => f.profiles.create('work SITES'))), 'VALIDATION');
	t.is(f.profiles.list().length, 1);
});

test('BRW-05 at most twenty named profiles exist', t => {
	const f = fixture();
	for (let i = 0; i < 20; i++) f.profiles.create(`profile ${i}`);
	t.is(code(t.throws(() => f.profiles.create('one more'))), 'LIMIT');
});

test('BRW-05 a project can use the shared default, a named profile or incognito, and back to its own', t => {
	const f = fixture();
	const made = f.profiles.create('Docs');
	f.profiles.assign(one, {kind: 'default'});
	t.deepEqual(f.profiles.resolve(one), {kind: 'default'});
	f.profiles.assign(one, {kind: 'named', id: made.id});
	t.deepEqual(f.profiles.resolve(one), {kind: 'named', id: made.id});
	f.profiles.assign(two, {kind: 'incognito'});
	t.deepEqual(f.profiles.resolve(two), {kind: 'incognito'});
	f.profiles.assign(one, {kind: 'project'});
	t.deepEqual(f.profiles.resolve(one), {kind: 'project'});
	t.false(one in f.data().assignments);
});

test('BRW-05 a project cannot be assigned a profile that does not exist', t => {
	const f = fixture();
	const error = t.throws(() =>
		f.profiles.assign(one, {
			kind: 'named',
			id: '0c7b2a54-1d6e-4f8a-9b3c-5e2d1a0f9c88',
		}),
	);
	t.is(code(error), 'NOT_FOUND');
	t.is(f.writes(), 0);
});

test('BRW-08 deleting a profile sends its projects back to their own profile and says which', t => {
	const f = fixture();
	const keep = f.profiles.create('Keep');
	const gone = f.profiles.create('Gone');
	f.profiles.assign(one, {kind: 'named', id: gone.id});
	f.profiles.assign(two, {kind: 'named', id: keep.id});
	const affected = f.profiles.delete(gone.id);
	t.deepEqual(affected, [one]);
	t.deepEqual(f.profiles.list(), [keep]);
	t.deepEqual(f.profiles.resolve(one), {kind: 'project'});
	t.deepEqual(f.profiles.resolve(two), {kind: 'named', id: keep.id});
	t.is(code(t.throws(() => f.profiles.delete(gone.id))), 'NOT_FOUND');
});

test('BRW-05 an assignment to a profile that is missing resolves to the project profile', t => {
	const f = fixture();
	const made = f.profiles.create('Temp');
	f.profiles.assign(one, {kind: 'named', id: made.id});
	const data = f.data();
	data.profiles = [];
	const orphan = new BrowserProfiles({get: () => data, set: () => {}});
	t.deepEqual(orphan.resolve(one), {kind: 'project'});
});
