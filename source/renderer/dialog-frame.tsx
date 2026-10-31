import * as React from 'react';

// Temporary shell for the project and runtime dialogs. S5a's shared dialog
// shell takes the same props, so swapping it in is an import change.
export function DialogFrame({
	title,
	onClose,
	footer,
	children,
}: {
	title: string;
	onClose(): void;
	footer?: React.ReactNode;
	children: React.ReactNode;
}): React.ReactElement {
	const dialog = React.useRef<HTMLDialogElement>(null);
	const dismiss = React.useRef<HTMLButtonElement>(null);
	const titleId = React.useId();
	React.useLayoutEffect(() => {
		const element = dialog.current;
		element?.showModal();
		dismiss.current?.focus();
		return () => element?.close();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="overlay-dialog dialog-frame"
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="dialog-frame-content">
				<header className="dialog-frame-head">
					<h2 id={titleId}>{title}</h2>
					<button
						ref={dismiss}
						type="button"
						className="dialog-frame-dismiss"
						aria-label="dismiss dialog"
						onClick={onClose}
					>
						<span aria-hidden="true">×</span>
					</button>
				</header>
				<div className="dialog-frame-body">{children}</div>
				{footer && <footer className="dialog-frame-foot">{footer}</footer>}
			</div>
		</dialog>
	);
}
