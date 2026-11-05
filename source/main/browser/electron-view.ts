import {
	type BrowserWindow,
	type Session,
	session,
	WebContentsView,
} from 'electron';
import type {
	BrowserViewHandle,
	BrowserViewLaunch,
} from '@/main/browser/browser-service';
import {isLoopbackPage} from '@/main/browser/origin';
import {denyBrowserPermissions} from '@/main/browser/profile';

const browserSessions = new WeakSet<Session>();

export function isBrowserSession(candidate: Session): boolean {
	return browserSessions.has(candidate);
}

export function createElectronViewFactory(
	host: () => BrowserWindow | undefined,
): (launch: BrowserViewLaunch) => BrowserViewHandle {
	return launch => {
		const window = host();
		if (!window) throw new Error('No window');
		const partition = session.fromPartition(launch.partition);
		browserSessions.add(partition);
		denyBrowserPermissions(partition);
		const view = new WebContentsView({webPreferences: launch.preferences});
		const contents = view.webContents;
		contents.setWindowOpenHandler(() => ({action: 'deny'}));
		const keepOnLoopback = (event: {preventDefault(): void}, url: string) => {
			if (!isLoopbackPage(url)) event.preventDefault();
		};
		contents.on('will-navigate', keepOnLoopback);
		contents.on('will-redirect', keepOnLoopback);
		view.setVisible(false);
		window.contentView.addChildView(view);
		return {
			load: url =>
				new Promise<void>((resolve, reject) => {
					const cleanup = () => {
						contents.removeListener('did-finish-load', finished);
						contents.removeListener('did-fail-load', failed);
					};
					const finished = () => {
						cleanup();
						resolve();
					};
					const failed = (
						_event: unknown,
						_code: number,
						_description: string,
						_url: string,
						isMainFrame: boolean,
					) => {
						if (!isMainFrame) return;
						cleanup();
						reject(new Error('load failed'));
					};
					contents.on('did-finish-load', finished);
					contents.on('did-fail-load', failed);
					contents.loadURL(url).catch(() => {
						cleanup();
						reject(new Error('load failed'));
					});
				}),
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
