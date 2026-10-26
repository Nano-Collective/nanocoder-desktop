import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {app, BrowserWindow, net, protocol, session} from 'electron';
import {
	APP_ORIGIN,
	APP_SCHEME,
	contentSecurityPolicy,
	isAllowedNavigation,
	resolveRendererFile,
} from '@/main/security';
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
		if (!isAllowedNavigation(url, allowedOrigins)) {
			event.preventDefault();
		}
	});
	contents.on('will-redirect', (event, url) => {
		if (!isAllowedNavigation(url, allowedOrigins)) {
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
		if (smokeTest) {
			app.exit(0);
			return;
		}
		window.show();
	});
	window.webContents.once('did-fail-load', () => {
		if (smokeTest) {
			app.exit(1);
		}
	});
	void window.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
}

void app.whenReady().then(() => {
	serveRenderer();
	lockDownSession();
	createWindow();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
