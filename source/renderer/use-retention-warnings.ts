import * as React from 'react';
import type {RetentionWarnings} from '@/shared/retention';

// Threads whose saved session Nanocoder may delete soon, in every project (CHAT-23). Metadata only.
export function useRetentionWarnings(
	refreshKey: string,
): RetentionWarnings | null {
	const [warnings, setWarnings] = React.useState<RetentionWarnings | null>(
		null,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey asks for another read.
	React.useEffect(() => {
		let current = true;
		void window.desktop
			.getRetentionWarnings({})
			.then(result => {
				if (current && result.ok) setWarnings(result.value);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [refreshKey]);
	return warnings;
}
