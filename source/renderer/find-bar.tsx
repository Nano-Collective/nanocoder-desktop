import * as React from 'react';
import {findKeyAction, findStatus} from '@/renderer/find-model';
import {Icon} from '@/renderer/icons';
import {Button} from '@/renderer/ui';

export interface FindBarProps {
	open: boolean;
	query: string;
	activeIndex: number;
	total: number;
	scopeLabel: string;
	hostLabel: string;
	inputRef: React.Ref<HTMLInputElement>;
	onQueryChange(query: string): void;
	onNext(): void;
	onPrevious(): void;
	onClose(): void;
}

// Plain props only: the host owns the query, the results and focus return.
export function FindBar({
	open,
	query,
	activeIndex,
	total,
	scopeLabel,
	hostLabel,
	inputRef,
	onQueryChange,
	onNext,
	onPrevious,
	onClose,
}: FindBarProps): React.ReactElement | null {
	if (!open) return null;
	return (
		<div className="find-bar" role="search">
			<input
				ref={inputRef}
				type="search"
				value={query}
				placeholder={`find in ${scopeLabel}…`}
				aria-label={hostLabel}
				autoComplete="off"
				spellCheck={false}
				onChange={event => onQueryChange(event.currentTarget.value)}
				onKeyDown={event => {
					const action = findKeyAction({
						key: event.key,
						shiftKey: event.shiftKey,
						metaKey: event.metaKey,
						ctrlKey: event.ctrlKey,
						composing: event.nativeEvent.isComposing,
					});
					if (action === 'none') return;
					event.preventDefault();
					switch (action) {
						case 'next':
							onNext();
							break;
						case 'previous':
							onPrevious();
							break;
						case 'close':
							event.stopPropagation();
							onClose();
							break;
						case 'select-all':
							event.currentTarget.select();
							break;
					}
				}}
			/>
			<p className="find-bar-status" role="status" aria-live="polite">
				{findStatus(query, activeIndex, total, scopeLabel)}
			</p>
			<Button
				aria-label="previous match"
				disabled={total === 0}
				onClick={onPrevious}
			>
				previous
			</Button>
			<Button aria-label="next match" disabled={total === 0} onClick={onNext}>
				next
			</Button>
			<Button aria-label="close find" onClick={onClose}>
				<Icon name="close" />
			</Button>
		</div>
	);
}
