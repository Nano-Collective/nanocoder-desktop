import type {PromptAttachment} from '@/shared/ipc';

export const MAX_ATTACHMENTS = 20;

export interface AttachmentChip {
	id: string;
	label: string;
}

// Attachments belong to one thread and live only in memory until the next
// prompt carries them (CHAT-16): nothing here is written anywhere.
export type AttachmentStore = Record<string, PromptAttachment[]>;

export const attachmentKey = (projectId: string, threadId: string): string =>
	`${projectId}\u0000${threadId}`;

export function labelFor(item: PromptAttachment): string {
	if (item.kind === 'file') return item.path;
	return item.startLine === item.endLine
		? `${item.path}:${item.startLine} (comment)`
		: `${item.path}:${item.startLine}-${item.endLine} (comment)`;
}

export function chips(list: readonly PromptAttachment[]): AttachmentChip[] {
	return list.map((item, index) => ({
		id: `${index}:${labelFor(item)}`,
		label: labelFor(item),
	}));
}

// A file already attached is not attached twice; comments are always separate.
export function addAttachment(
	store: AttachmentStore,
	key: string,
	item: PromptAttachment,
): AttachmentStore {
	const current = store[key] ?? [];
	if (current.length >= MAX_ATTACHMENTS) return store;
	if (
		item.kind === 'file' &&
		current.some(other => other.kind === 'file' && other.path === item.path)
	)
		return store;
	return {...store, [key]: [...current, item]};
}

export function removeAttachment(
	store: AttachmentStore,
	key: string,
	id: string,
): AttachmentStore {
	const current = store[key] ?? [];
	const kept = current.filter(
		(item, index) => `${index}:${labelFor(item)}` !== id,
	);
	if (kept.length === current.length) return store;
	const {[key]: _removed, ...rest} = store;
	return kept.length ? {...rest, [key]: kept} : rest;
}

export function clearAttachments(
	store: AttachmentStore,
	key: string,
): AttachmentStore {
	if (!(key in store)) return store;
	const {[key]: _removed, ...rest} = store;
	return rest;
}
