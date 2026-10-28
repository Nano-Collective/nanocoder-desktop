interface Closeable {
	close(): void | Promise<void>;
}

export async function disposeDesktop(options: {
	unsubscribe?: () => void;
	cancelPermissions: () => void;
	supervisor?: Closeable;
	connection?: Closeable;
	store?: Closeable;
}): Promise<void> {
	const failures: unknown[] = [];
	const attempt = async (action: () => void | Promise<void>) => {
		try {
			await action();
		} catch (error) {
			failures.push(error);
		}
	};
	await attempt(() => options.unsubscribe?.());
	await attempt(options.cancelPermissions);
	await Promise.all([
		attempt(() => options.supervisor?.close()),
		attempt(() => options.connection?.close()),
	]);
	await attempt(() => options.store?.close());
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			'Desktop services did not close cleanly',
		);
	}
}

export function createQuitHandler(
	dispose: () => Promise<void>,
	quit: () => void,
): (event: {preventDefault(): void}) => void {
	let pending = false;
	let disposed = false;
	return event => {
		if (disposed) return;
		event.preventDefault();
		if (pending) return;
		pending = true;
		void Promise.resolve()
			.then(dispose)
			.catch(() => {})
			.then(() => {
				// Let Electron finish cancelling the first quit before trying again.
				setImmediate(() => {
					disposed = true;
					quit();
				});
			});
	};
}
