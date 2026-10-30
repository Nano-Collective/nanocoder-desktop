import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {electron} from './electron';
import {qaEnvironment} from './environment';

const root = path.resolve(import.meta.dirname, '../..');
if (!existsSync(path.join(root, 'out/main/index.js'))) {
	throw new Error('Run pnpm build before pnpm qa:launch');
}

const qa = path.join(root, '.qa');
mkdirSync(qa, {recursive: true});
const work = realpathSync.native(mkdtempSync(path.join(qa, 'launch-')));
const fakeCli = path.join(work, 'nanocoder/dist/cli.js');
const project = path.join(work, 'project');
mkdirSync(path.dirname(fakeCli), {recursive: true});
mkdirSync(project);
writeFileSync(path.join(project, '.fake-nanocoder'), 'untrusted');
writeFileSync(
	path.join(work, 'nanocoder/package.json'),
	JSON.stringify({
		name: '@nanocollective/nanocoder',
		version: '9.9.9',
		type: 'module',
		bin: {nanocoder: 'dist/cli.js'},
	}),
);
copyFileSync(
	path.join(root, 'source/main/nanocoder/fixtures/fake-nanocoder.mjs'),
	fakeCli,
);

const app = await electron.launch({
	cwd: root,
	args: [
		root,
		'--remote-debugging-address=127.0.0.1',
		'--remote-debugging-port=9333',
		`--user-data-dir=${path.join(work, 'profile')}`,
	],
	env: qaEnvironment(process.env, {
		cliPath: fakeCli,
		nodePath: process.execPath,
	}),
});
const closed = app.waitForEvent('close', {timeout: 0});

let closing = false;
const close = async () => {
	if (closing) return;
	closing = true;
	await app.close();
};
const onSignal = () => {
	void close().catch(() => {
		process.exitCode = 1;
	});
};
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
try {
	await app.evaluate(({dialog}, folder) => {
		dialog.showOpenDialog = (async () => ({
			canceled: false,
			filePaths: [folder],
		})) as typeof dialog.showOpenDialog;
		dialog.showMessageBox = (async () => ({
			response: 0,
			checkboxChecked: false,
		})) as typeof dialog.showMessageBox;
	}, project);
	await app.firstWindow();
	console.info('QA ready: agent-browser connect 9333 (fake Nanocoder only)');
	console.info(
		'QA native presentation:',
		await app.evaluate(({app: main, BrowserWindow}) => ({
			windows: BrowserWindow.getAllWindows().map(window => ({
				visible: window.isVisible(),
				focused: window.isFocused(),
			})),
			dock: main.dock?.isVisible() ?? false,
		})),
	);
	console.info(`QA files: ${work}`);
	console.info(`QA launcher PID: ${process.pid}`);
	await closed;
} finally {
	process.removeListener('SIGINT', onSignal);
	process.removeListener('SIGTERM', onSignal);
	if (!closing) await close();
}
