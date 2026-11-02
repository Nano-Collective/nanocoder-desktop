import test from 'ava';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {OverlayRequest} from '@/renderer/overlay-model';
import {overlayRules} from '@/renderer/overlay-model';
import {OverlayProvider} from '@/renderer/overlays';

function rules(busy: OverlayRequest[] = []) {
	const calls: string[] = [];
	const controller = overlayRules({
		canClose: request => !busy.includes(request),
		hide() {
			calls.push('hide');
		},
		onClosed(request) {
			calls.push(`closed:${request}`);
		},
	});
	return {controller, calls};
}

test('a closed overlay provider renders no dialog content and never asks for one', t => {
	let requested = 0;
	const html = renderToStaticMarkup(
		createElement(OverlayProvider, {
			actions: [],
			renderDialog() {
				requested++;
				return null;
			},
			children: null,
		}),
	);
	t.is(requested, 0);
	t.false(html.includes('dialog-shell'));
	t.false(html.includes('palette-search'));
	t.false(html.includes('shortcut-list'));
	t.false(/<dialog[^>]* open/.test(html));
});

test('a busy dialog refuses replacement and close and keeps its request', t => {
	const {controller, calls} = rules(['diagnostics']);
	t.true(controller.open('diagnostics'));
	t.false(controller.open('palette'));
	t.is(controller.current(), 'diagnostics');
	t.false(controller.close());
	t.is(controller.current(), 'diagnostics');
	t.deepEqual(calls, []);
});

test('an idle dialog reports onClosed when it is replaced or closed', t => {
	const {controller, calls} = rules();
	t.true(controller.open('diagnostics'));
	t.true(controller.open('palette'));
	t.is(controller.current(), 'palette');
	t.deepEqual(calls, ['closed:diagnostics']);
	t.true(controller.open('palette'));
	t.deepEqual(calls, ['closed:diagnostics']);
	t.true(controller.close());
	t.is(controller.current(), null);
	t.deepEqual(calls, ['closed:diagnostics', 'hide', 'closed:palette']);
});

test('closeIf closes the named request without asking canClose', t => {
	const {controller, calls} = rules(['diagnostics']);
	t.true(controller.open('diagnostics'));
	t.false(controller.closeIf('palette'));
	t.is(controller.current(), 'diagnostics');
	t.true(controller.closeIf('diagnostics'));
	t.is(controller.current(), null);
	t.deepEqual(calls, ['hide', 'closed:diagnostics']);
});
