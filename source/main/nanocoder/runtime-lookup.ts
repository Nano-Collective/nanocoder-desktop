// Remembers a successful lookup, so the runtime is resolved once (REL-01), but never a failure:
// installing Nanocoder after the app has started must not need a restart.
export function createLookup<T extends {ok: boolean}>(
	resolve: () => Promise<T>,
): () => Promise<T> {
	let pending: Promise<T> | undefined;
	return () => {
		pending ??= resolve().then(
			result => {
				if (!result.ok) pending = undefined;
				return result;
			},
			error => {
				pending = undefined;
				throw error;
			},
		);
		return pending;
	};
}
