import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {app, BrowserWindow, dialog, net, protocol, session} from 'electron';
import {closeNanocoder, registerIpcHandlers} from '@/main/ipc';
import {IpcFailure} from '@/main/ipc/handle-request';
import {createQuitHandler, createWindowRequestHandler} from '@/main/lifecycle';
import {
	APP_ORIGIN,
	APP_SCHEME,
	contentSecurityPolicy,
	isAllowedOrigin,
	resolveRendererFile,
} from '@/main/security';
import {desktopStoreFactory} from '@/main/store';
import {createNodeSqliteDriver} from '@/main/store/node-sqlite';
import {APP_NAME} from '@/shared/app-info';

const devServerUrl = process.env.ELECTRON_RENDERER_URL;
// Used by the packaged-app smoke test in CI: start, then exit.
const smokeTest = process.argv.includes('--smoke-test');
const rendererRoot = path.join(import.meta.dirname, '../renderer');
const preloadPath = path.join(import.meta.dirname, '../preload/index.cjs');
const allowedOrigins = devServerUrl
	? [new URL(devServerUrl).origin]
	: [APP_ORIGIN];

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
	{
		scheme: APP_SCHEME,
		privileges: {standard: true, secure: true, supportFetchAPI: true},
	},
]);
app.enableSandbox();
const primaryInstance = app.requestSingleInstanceLock();
const windowRequests = createWindowRequestHandler(() => {
	const window = BrowserWindow.getAllWindows()[0];
	if (!window) {
		createWindow();
		return;
	}
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
});
app.on('second-instance', windowRequests.request);
app.on('activate', windowRequests.request);
app.on('before-quit', windowRequests.stop);
app.on('will-quit', windowRequests.stop);
if (!primaryInstance) app.quit();

function serveRenderer(): void {
	protocol.handle(APP_SCHEME, async request => {
		const filePath = resolveRendererFile(request.url, rendererRoot);
		if (!filePath) {
			return new Response('Not found', {status: 404});
		}
		const response = await net.fetch(pathToFileURL(filePath).toString());
		const headers = new Headers(response.headers);
		headers.set('Content-Security-Policy', contentSecurityPolicy());
		return new Response(response.body, {status: response.status, headers});
	});
}

function lockDownSession(): void {
	const {defaultSession} = session;
	defaultSession.setPermissionRequestHandler((_contents, _permission, done) =>
		done(false),
	);
	defaultSession.setPermissionCheckHandler(() => false);

	if (devServerUrl) {
		defaultSession.webRequest.onHeadersReceived(
			{urls: [`${devServerUrl}/*`]},
			(details, done) => {
				done({
					responseHeaders: {
						...details.responseHeaders,
						'Content-Security-Policy': [contentSecurityPolicy(devServerUrl)],
					},
				});
			},
		);
	}
}

app.on('web-contents-created', (_event, contents) => {
	contents.setWindowOpenHandler(() => ({action: 'deny'}));
	contents.on('will-navigate', (event, url) => {
		if (!isAllowedOrigin(url, allowedOrigins)) {
			event.preventDefault();
		}
	});
	contents.on('will-redirect', (event, url) => {
		if (!isAllowedOrigin(url, allowedOrigins)) {
			event.preventDefault();
		}
	});
	contents.on('will-attach-webview', event => event.preventDefault());
});

function createWindow(): void {
	const window = new BrowserWindow({
		title: APP_NAME,
		show: false,
		webPreferences: {
			preload: preloadPath,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
		},
	});
	window.once('ready-to-show', () => {
		if (windowRequests.stopped) return;
		if (smokeTest) {
			app.exit(0);
			return;
		}
		window.show();
		window.focus();
	});
	window.webContents.once('did-fail-load', () => {
		if (smokeTest) {
			app.exit(1);
		}
	});
	void window.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
}

void app
	.whenReady()
	.then(async () => {
		if (!primaryInstance || windowRequests.stopped) return;
		const store = await desktopStoreFactory.open({
			databasePath: path.join(app.getPath('userData'), 'desktop.sqlite'),
			driver: createNodeSqliteDriver(),
		});
		if (windowRequests.stopped) {
			store.close();
			return;
		}
		serveRenderer();
		lockDownSession();
		registerIpcHandlers(allowedOrigins, {store});
		windowRequests.ready();
	})
	.catch((error: unknown) => {
		if (windowRequests.stopped) return;
		dialog.showErrorBox(
			'Cannot open Nanocoder Desktop',
			error instanceof IpcFailure
				? error.message
				: 'The desktop could not start',
		);
		app.quit();
	});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on(
	'will-quit',
	createQuitHandler(closeNanocoder, () => app.quit()),
);
