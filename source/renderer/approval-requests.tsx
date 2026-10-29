import * as React from 'react';
import {Button, Card} from '@/renderer/ui';
import type {DesktopApi} from '@/shared/desktop-api';
import type {NanocoderMode, PermissionRequestInfo} from '@/shared/ipc';

function canFocus(
	target: HTMLElement | null | undefined,
): target is HTMLElement {
	return !!(
		target?.isConnected &&
		!target.matches(':disabled, [hidden]') &&
		target.getClientRects().length
	);
}

function useApprovalFocus(
	requests: readonly PermissionRequestInfo[],
	answering: boolean,
	busy: boolean,
	fallback?: React.RefObject<HTMLElement | null>,
) {
	const container = React.useRef<HTMLDivElement>(null);
	const dialogs = React.useRef(new Map<string, HTMLDivElement>());
	const lastOutside = React.useRef<HTMLElement | null>(null);
	const origin = React.useRef<HTMLElement | null | undefined>(undefined);
	const previous = React.useRef<string | undefined>(undefined);

	React.useEffect(() => {
		const remember = () => {
			const active = document.activeElement;
			if (
				active instanceof HTMLElement &&
				active !== document.body &&
				!container.current?.contains(active)
			)
				lastOutside.current = active;
		};
		remember();
		document.addEventListener('focusin', remember);
		return () => document.removeEventListener('focusin', remember);
	}, []);

	React.useLayoutEffect(() => {
		const firstId = requests[0]?.id;
		if (firstId && origin.current === undefined) {
			const active = document.activeElement;
			origin.current =
				active instanceof HTMLElement &&
				active !== document.body &&
				!container.current?.contains(active)
					? active
					: lastOutside.current;
		}
		const focus = () => {
			if (answering || document.querySelector('dialog:modal')) return;
			if (firstId) {
				if (
					previous.current !== firstId ||
					document.activeElement === document.body
				) {
					const dialog = dialogs.current.get(firstId);
					dialog?.focus({preventScroll: true});
					dialog
						?.closest('.ui-card--approval')
						?.scrollIntoView({block: 'nearest'});
				}
			} else if (origin.current !== undefined) {
				const target = canFocus(origin.current)
					? origin.current
					: fallback?.current;
				if (canFocus(target)) {
					origin.current = undefined;
					target.focus();
				} else if (!busy) {
					origin.current = undefined;
				}
			}
			previous.current = firstId;
		};
		focus();
		document.addEventListener('close', focus, true);
		return () => document.removeEventListener('close', focus, true);
	}, [requests, answering, busy, fallback]);

	return {container, dialogs};
}

function PermissionCard({
	request,
	mode,
	dialogRef,
	answering,
	error,
	choose,
}: {
	request: PermissionRequestInfo;
	mode: NanocoderMode;
	dialogRef: React.Ref<HTMLDivElement>;
	answering: boolean;
	error: string | undefined;
	choose(request: PermissionRequestInfo, optionId: string): void;
}) {
	const id = React.useId();
	return (
		<Card variant="approval" aria-label="permission request">
			<div
				ref={dialogRef}
				className="approval-dialog"
				role="alertdialog"
				aria-modal="false"
				aria-labelledby={`${id}-title`}
				aria-describedby={`${id}-command ${id}-effect`}
				tabIndex={-1}
				onKeyDown={event => {
					if (
						event.repeat ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey ||
						event.shiftKey ||
						!/^[1-9]$/.test(event.key) ||
						answering
					)
						return;
					const index = '123456789'.indexOf(event.key);
					const option = index < 0 ? undefined : request.options[index];
					if (!option) return;
					event.preventDefault();
					choose(request, option.id);
				}}
			>
				<h2 id={`${id}-title`}>
					<span aria-hidden="true">▲ </span>
					approval required · protected tool · {mode} mode
				</h2>
				<p id={`${id}-command`}>
					<code>{request.title}</code>
				</p>
				<p id={`${id}-effect`} className="approval-effect">
					your choice is sent to Nanocoder; nothing is selected by default
				</p>
				<div className="gate-actions approval-key-hints">
					{request.options.map((option, index) => {
						const allow = option.kind.startsWith('allow');
						const shortcut = index < 9 ? String(index + 1) : undefined;
						return (
							<Button
								key={option.id}
								variant={allow ? 'allow' : 'reject'}
								keyHint={shortcut ?? '⏎'}
								aria-keyshortcuts={shortcut}
								disabled={answering}
								onClick={() => choose(request, option.id)}
							>
								<span aria-hidden="true">{allow ? '✓' : '✕'}</span>
								{option.name}
							</Button>
						);
					})}
				</div>
				{!request.options.length && (
					<p>Nanocoder offered no options; cancel the turn to continue.</p>
				)}
				{error && <p role="alert">{error}</p>}
			</div>
		</Card>
	);
}

export function ApprovalRequests({
	requests,
	mode,
	busy,
	fallbackFocus,
	onAnswer,
}: {
	requests: readonly PermissionRequestInfo[];
	mode: NanocoderMode;
	busy: boolean;
	fallbackFocus?: React.RefObject<HTMLElement | null>;
	onAnswer: DesktopApi['answerPermission'];
}) {
	const pending = React.useRef(false);
	const [answering, setAnswering] = React.useState(false);
	const {container, dialogs} = useApprovalFocus(
		requests,
		answering,
		busy,
		fallbackFocus,
	);
	const [error, setError] = React.useState<{
		id: string;
		message: string;
	} | null>(null);
	const choose = async (request: PermissionRequestInfo, optionId: string) => {
		if (pending.current) return;
		pending.current = true;
		setAnswering(true);
		setError(null);
		try {
			const result = await onAnswer(request.id, optionId);
			if (!result.ok) setError({id: request.id, message: result.error.message});
		} catch {
			setError({
				id: request.id,
				message: 'could not send this choice. try again.',
			});
		} finally {
			pending.current = false;
			setAnswering(false);
		}
	};
	return requests.length ? (
		<div className="approval-requests" ref={container}>
			{requests.map(request => (
				<PermissionCard
					key={request.id}
					request={request}
					mode={mode}
					dialogRef={node => {
						if (node) dialogs.current.set(request.id, node);
						else dialogs.current.delete(request.id);
					}}
					answering={answering}
					error={error?.id === request.id ? error.message : undefined}
					choose={(request, optionId) => {
						void choose(request, optionId);
					}}
				/>
			))}
		</div>
	) : null;
}
