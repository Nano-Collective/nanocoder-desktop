import {useEffect, useState} from 'react';
import type {AppInfo, IpcResult, NanocoderRuntime} from '@/shared/ipc';

export function App() {
	const [info, setInfo] = useState<AppInfo | null>(null);
	const [runtime, setRuntime] = useState<IpcResult<NanocoderRuntime> | null>(
		null,
	);

	useEffect(() => {
		void window.desktop.getAppInfo().then(result => {
			if (result.ok) {
				setInfo(result.value);
			}
		});
		void window.desktop.getNanocoderRuntime().then(setRuntime);
	}, []);

	return (
		<main>
			<h1>{info?.name}</h1>
			{info && <p>Version {info.version}. Pre-v0.1. Nothing here works yet.</p>}
			{runtime?.ok && (
				<p>
					Nanocoder {runtime.value.version} at {runtime.value.cliPath}, on
					Node.js {runtime.value.nodeVersion} at {runtime.value.nodePath}
				</p>
			)}
			{runtime && !runtime.ok && <p role="alert">{runtime.error.message}</p>}
		</main>
	);
}
