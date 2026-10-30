import {createElement} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {AppShell} from '@/renderer/app-shell';

export function mountShellFixture() {
	const app = document.getElementById('root');
	if (app) app.hidden = true;
	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container);
	const render = (open: boolean) =>
		flushSync(() =>
			root.render(
				createElement(AppShell, {
					title: 'Nanocoder',
					statusBadges: null,
					projectRail: createElement('button', null, 'fixture project'),
					children: createElement(
						'button',
						{id: 'fixture-open-panel', onClick: () => render(true)},
						'open fixture panel',
					),
					composer: createElement('textarea', {
						'aria-label': 'fixture draft',
						defaultValue: 'kept draft',
					}),
					workbench: open
						? {
								title: 'fixture workbench',
								children: createElement('p', null, 'later content fixture'),
								onClose() {
									render(false);
									document.getElementById('fixture-open-panel')?.focus();
								},
							}
						: undefined,
				}),
			),
		);
	render(false);
	return () => {
		flushSync(() => root.unmount());
		container.remove();
		if (app) app.hidden = false;
	};
}
