import {runInNewContext} from 'node:vm';
import test from 'ava';
import {PAGE_SCRIPTS, pageCall} from '@/main/browser-control/page-scripts';

test('agent values reach a page script only as JSON data, never as code (SEC-13)', t => {
	const hostile = {
		selector: '"]);globalThis.ran=true;//',
		text: '</script><script>globalThis.ran=true</script>  ${x}`',
	};
	const sandbox: {ran?: boolean} = {};
	const result = runInNewContext(pageCall('(args) => args', hostile), sandbox);
	t.deepEqual(result, hostile);
	t.is(sandbox.ran, undefined);
});

test('every page script is a fixed function expression that parses', t => {
	for (const [name, script] of Object.entries(PAGE_SCRIPTS)) {
		t.notThrows(() => new Function(`return (${script});`), name);
		t.false(/\beval\s*\(|new Function|import\s*\(/.test(script), name);
	}
	t.deepEqual(Object.keys(PAGE_SCRIPTS).sort(), [
		'locate',
		'prepareType',
		'probe',
		'scroll',
		'snapshot',
		'viewport',
	]);
});
