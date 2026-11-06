import {IpcFailure} from '@/main/ipc/handle-request';

export function createExternalOpener(deps: {
	confirm(url: string): Promise<boolean>;
	open(url: string): Promise<void>;
}): (url: string) => Promise<boolean> {
	return async url => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new IpcFailure('DENIED', 'Only http and https pages open outside');
		}
		if (
			(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
			parsed.username !== '' ||
			parsed.password !== ''
		)
			throw new IpcFailure('DENIED', 'Only http and https pages open outside');
		if (!(await deps.confirm(url))) return false;
		await deps.open(url);
		return true;
	};
}
