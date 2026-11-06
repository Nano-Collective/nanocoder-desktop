import {
	type BrowserWindow,
	type Session,
	session,
	WebContentsView,
} from 'electron';
import type {
	BrowserViewHandle,
	BrowserViewHooks,
	BrowserViewLaunch,
} from '@/main/browser/browser-service';
import {denyBrowserPermissions} from '@/main/browser/profile';

const browserSessions = new WeakSet<Session>();
const ERR_ABORTED = -3;

export function isBrowserSession(candidate: Session): boolean {
	return browserSessions.has(candidate);
}

export function createElectronViewFactory(
	host: () => BrowserWindow | undefined,
): (launch: BrowserViewLaunch, hooks: BrowserViewHooks) => BrowserViewHandle {
	return (launch, hooks) => {
		const window = host();
		if (!window) throw new Error('No window');
		const partition = session.fromPartition(launch.partition);
		browserSessions.add(partition);
		denyBrowserPermissions(partition);
		const view = new WebContentsView({webPreferences: launch.preferences});
		const contents = view.webContents;
		contents.setWindowOpenHandler(() => ({action: 'deny'}));
		const guard = (event: {preventDefault(): void}, url: string) => {
			if (!hooks.allow(url)) event.preventDefault();
		};
		contents.on('will-navigate', guard);
		contents.on('will-redirect', guard);
		const page = () =>
			hooks.navigated({
				url: contents.getURL(),
				title: contents.getTitle(),
				canGoBack: contents.navigationHistory.canGoBack(),
				canGoForward: contents.navigationHistory.canGoForward(),
			});
		contents.on('did-navigate', page);
		contents.on('did-navigate-in-page', page);
		contents.on('page-title-updated', page);
		contents.on('did-start-loading', () => hooks.loading(true));
		contents.on('did-stop-loading', () => hooks.loading(false));
		contents.on('did-fail-load', (_event, code, _text, _url, isMainFrame) => {
			if (isMainFrame && code !== ERR_ABORTED) hooks.failed();
		});
		let retire: (() => void) | undefined;
		view.setVisible(false);
		window.contentView.addChildView(view);
		return {
			load: url => {
				retire?.();
				return new Promise<'loaded' | 'aborted'>((resolve, reject) => {
					const cleanup = () => {
						retire = undefined;
						contents.removeListener('did-finish-load', finished);
						contents.removeListener('did-fail-load', failed);
						contents.removeListener('did-stop-loading', stopped);
					};
					const finished = () => {
						cleanup();
						resolve('loaded');
					};
					const stopped = () => {
						cleanup();
						resolve('aborted');
					};
					const failed = (
						_event: unknown,
						code: number,
						_description: string,
						_url: string,
						isMainFrame: boolean,
					) => {
						if (!isMainFrame || code === ERR_ABORTED) return;
						cleanup();
						reject(new Error('load failed'));
					};
					retire = stopped;
					contents.on('did-finish-load', finished);
					contents.on('did-fail-load', failed);
					contents.on('did-stop-loading', stopped);
					contents.loadURL(url).catch(() => {
						if (retire !== stopped) return;
						cleanup();
						reject(new Error('load failed'));
					});
				});
			},
			goBack: () => contents.navigationHistory.goBack(),
			goForward: () => contents.navigationHistory.goForward(),
			peek: action => {
				const history = contents.navigationHistory;
				const index = history.getActiveIndex() + (action === 'back' ? -1 : 1);
				return history.getEntryAtIndex(index)?.url ?? null;
			},
			reload: () => contents.reload(),
			stop: () => contents.stop(),
			setBounds: bounds => {
				if (bounds) view.setBounds(bounds);
				view.setVisible(bounds !== null);
			},
			destroy: () => {
				if (!window.isDestroyed()) window.contentView.removeChildView(view);
				if (!contents.isDestroyed()) contents.close();
			},
		};
	};
}
