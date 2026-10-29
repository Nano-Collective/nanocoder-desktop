import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '@/renderer/app';
import '@/renderer/styles/foundations.css';
import '@/renderer/styles/app-shell.css';
import '@/renderer/styles/technical-gate.css';
import '@/renderer/styles/overlays.css';
import '@/renderer/styles/projects.css';
import '@/renderer/styles/threads.css';

const root = document.getElementById('root');
if (!root) {
	throw new Error('Missing #root element');
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
