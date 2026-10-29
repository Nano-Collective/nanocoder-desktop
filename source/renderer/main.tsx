import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '@/renderer/app';
import '@/renderer/styles/foundations.css';
import '@/renderer/styles/app-shell.css';
import '@/renderer/styles/approvals.css';
import '@/renderer/styles/technical-gate.css';

const root = document.getElementById('root');
if (!root) {
	throw new Error('Missing #root element');
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
