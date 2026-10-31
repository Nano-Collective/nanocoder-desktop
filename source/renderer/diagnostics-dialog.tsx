import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {DiagnosticsSnapshot} from '@/shared/ipc';

export const diagnosticsDialogTitle = 'review captured diagnostics';

export interface DiagnosticsDialogProps {
	snapshot: DiagnosticsSnapshot;
	busy: boolean;
	message: string;
	onExport(): void;
}

export function DiagnosticsDialogBody({
	snapshot,
	message,
}: Pick<DiagnosticsDialogProps, 'snapshot' | 'message'>): React.ReactElement {
	return (
		<section aria-label="redacted diagnostics" className="diagnostic-review">
			<p>
				review this captured snapshot. exporting asks again in a native dialog,
				then asks where to save it. nothing is sent automatically.
			</p>
			{snapshot.truncated && <p>older or oversized diagnostics were omitted</p>}
			<pre tabIndex={0} role="region" aria-label="captured diagnostics">
				{snapshot.lines.join('\n') || 'No diagnostics were captured.'}
			</pre>
			<p>
				nothing is sent to a server. export uses a native save dialog after this
				review.
			</p>
			{message && <p role="status">{message}</p>}
		</section>
	);
}

export function DiagnosticsDialogFooter({
	busy,
	onExport,
	onClose,
}: Pick<DiagnosticsDialogProps, 'busy' | 'onExport'> & {
	onClose(): void;
}): React.ReactElement {
	const exportButton = React.useRef<HTMLButtonElement>(null);
	const wasBusy = React.useRef(busy);
	React.useEffect(() => {
		// A native export dialog disables this button; return focus when it settles.
		if (wasBusy.current && !busy && document.activeElement === document.body)
			exportButton.current?.focus();
		wasBusy.current = busy;
	}, [busy]);
	return (
		<>
			<Button onClick={onClose} disabled={busy}>
				close
			</Button>
			<Button ref={exportButton} onClick={onExport} disabled={busy}>
				choose export destination…
			</Button>
		</>
	);
}
