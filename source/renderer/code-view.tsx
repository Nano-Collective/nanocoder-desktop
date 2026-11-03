import * as React from 'react';
import type {CodeViewHandle} from '@/renderer/code-editor';

// The editor is loaded only when a file is opened, so it never weighs on the
// start of the app. Until it is ready, and if it cannot load, the text is shown
// plainly, so a preview is never empty.
export function CodeView({
	text,
	path,
	highlight,
	label,
}: {
	text: string;
	path: string;
	highlight: boolean;
	label: string;
}): React.ReactElement {
	const host = React.useRef<HTMLDivElement>(null);
	const [ready, setReady] = React.useState(false);
	React.useEffect(() => {
		let handle: CodeViewHandle | undefined;
		let cancelled = false;
		setReady(false);
		void import('@/renderer/code-editor')
			.then(async ({mountCodeView}) => {
				if (cancelled || !host.current) return;
				const mounted = await mountCodeView(host.current, {
					text,
					path,
					highlight,
					label,
				});
				if (cancelled) mounted.destroy();
				else {
					handle = mounted;
					setReady(true);
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
			handle?.destroy();
		};
	}, [text, path, highlight, label]);
	return (
		<div className="code-view" data-ready={ready}>
			<div ref={host} className="code-view-host" hidden={!ready} />
			{!ready && (
				<pre className="code-view-plain" tabIndex={0} aria-label={label}>
					{text}
				</pre>
			)}
		</div>
	);
}
