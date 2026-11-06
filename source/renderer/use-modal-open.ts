import {useEffect, useState} from 'react';

// A native browser view draws above the page, so it must step aside for any open dialog.
export function useModalOpen(): boolean {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const check = () =>
			setOpen(document.querySelector('dialog[open]') !== null);
		const observer = new MutationObserver(check);
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['open'],
		});
		check();
		return () => observer.disconnect();
	}, []);
	return open;
}
