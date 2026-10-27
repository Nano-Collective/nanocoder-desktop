import {useEffect, useState} from 'react';
import type {AppInfo} from '@/shared/ipc';

export function App() {
	const [info, setInfo] = useState<AppInfo | null>(null);

	useEffect(() => {
		void window.desktop.getAppInfo().then(result => {
			if (result.ok) {
				setInfo(result.value);
			}
		});
	}, []);

	return (
		<main>
			<h1>{info?.name}</h1>
			{info && <p>Version {info.version}. Pre-v0.1. Nothing here works yet.</p>}
		</main>
	);
}
