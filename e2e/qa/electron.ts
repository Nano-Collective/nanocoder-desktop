import {_electron, type ElectronApplication, type Page} from '@playwright/test';
import {hiddenTestWindows} from '@/main/window-presentation';
import {
	hiddenFrameSinkRequired,
	startHiddenFrameSink,
} from './hidden-frame-sink';
import {e2eArguments} from './launch-options';

const rawLaunch = _electron.launch.bind(_electron);

export const electron = {
	async launch(
		options: Parameters<typeof rawLaunch>[0] = {},
	): Promise<ElectronApplication> {
		const args = e2eArguments(options.args ?? []);
		const app = await rawLaunch({...options, args});
		const isPackaged = await app.evaluate(({app}) => app.isPackaged);
		if (!hiddenTestWindows(isPackaged, args)) return app;

		const prepared = new WeakMap<Page, Promise<void>>();
		const preparing = new Set<Promise<void>>();
		const frameSinks = new Set<() => Promise<void>>();
		const prepare = (page: Page): Promise<void> => {
			const existing = prepared.get(page);
			if (existing) return existing;
			const pending = (async () => {
				const cdp = await app.context().newCDPSession(page);
				await cdp.send('Emulation.setFocusEmulationEnabled', {enabled: true});
				if (hiddenFrameSinkRequired(isPackaged, args, process.platform)) {
					const stop = await startHiddenFrameSink(cdp);
					frameSinks.add(stop);
					page.once('close', () => frameSinks.delete(stop));
				}
			})();
			prepared.set(page, pending);
			preparing.add(pending);
			void pending.then(
				() => preparing.delete(pending),
				() => preparing.delete(pending),
			);
			return pending;
		};
		app.on('window', page => void prepare(page));
		for (const page of app.windows()) void prepare(page);

		const firstWindow = app.firstWindow.bind(app);
		app.firstWindow = async options => {
			const page = await firstWindow(options);
			await prepare(page);
			return page;
		};
		const waitForEvent = app.waitForEvent.bind(app);
		app.waitForEvent = (async (...args: Parameters<typeof waitForEvent>) => {
			const result = await waitForEvent(...args);
			if (args[0] === 'window') await prepare(result as Page);
			return result;
		}) as typeof app.waitForEvent;
		const close = app.close.bind(app);
		app.close = async () => {
			await Promise.allSettled([...preparing]);
			await Promise.allSettled([...frameSinks].map(stop => stop()));
			await close();
		};
		return app;
	},
};
