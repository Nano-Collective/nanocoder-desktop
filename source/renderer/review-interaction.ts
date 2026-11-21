import type {DiffCursor} from '@/renderer/diff-parse';

export interface ReviewInteractionIdentity {
	projectId: string | null;
	path: string;
	staged: boolean;
	agent: boolean;
}

export interface ReviewInteraction {
	cursor: DiffCursor | null;
	comment: string;
	added: string | null;
}

export type ReviewInteractions = Readonly<
	Record<string, ReviewInteraction | undefined>
>;

export const emptyInteraction: ReviewInteraction = {
	cursor: null,
	comment: '',
	added: null,
};

export function interactionKey(identity: ReviewInteractionIdentity): string {
	return JSON.stringify([
		identity.projectId,
		identity.path,
		identity.staged,
		identity.agent,
	]);
}

export function interactionFor(
	drafts: ReviewInteractions,
	identity: ReviewInteractionIdentity,
): ReviewInteraction {
	return drafts[interactionKey(identity)] ?? emptyInteraction;
}

export function storeInteraction(
	drafts: ReviewInteractions,
	identity: ReviewInteractionIdentity,
	interaction: ReviewInteraction,
): ReviewInteractions {
	return {...drafts, [interactionKey(identity)]: interaction};
}
