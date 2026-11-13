import type {IpcResult} from '@/shared/ipc';

export const REVIEW_CHANNELS = {
	status: 'review:status',
	diff: 'review:diff',
	agentDiff: 'review:agent-diff',
} as const;

// What Git reports for one path, reduced to what the tree and review list show.
export type ReviewMark =
	| 'modified'
	| 'added'
	| 'deleted'
	| 'renamed'
	| 'untracked'
	| 'conflicted'
	| 'ignored';

export type ChangeState = 'none' | 'modified' | 'added' | 'deleted' | 'renamed';

export interface ReviewEntry {
	path: string;
	// The old path for a rename or copy.
	oldPath: string | null;
	staged: ChangeState;
	unstaged: ChangeState;
	untracked: boolean;
	conflicted: boolean;
	// Edited by a tool call in the latest Nanocoder turn (GIT-05).
	touched: boolean;
}

export interface TurnCommit {
	hash: string;
	subject: string;
}

export interface TurnReview {
	threadId: string;
	running: boolean;
	touched: string[];
	headBefore: string | null;
	headAfter: string | null;
	// Commits made while the turn ran, for example by Nanocoder's autoCommit (GIT-12).
	commits: TurnCommit[];
}

export type ReviewStatus =
	| {
			available: false;
			// Why review cannot be shown; the file browser keeps working (GIT-13).
			reason: string;
	  }
	| {
			available: true;
			git: {path: string; version: string};
			head: string | null;
			branch: string | null;
			entries: ReviewEntry[];
			notShown: number;
			turn: TurnReview | null;
			// Whether Nanocoder's pre-edit snapshots can show only the agent's lines (GIT-09).
			agentChanges: {enabled: boolean; reason: string | null};
	  };

export type ReviewDiff =
	| {
			path: string;
			staged: boolean;
			kind: 'text';
			diff: string;
			added: number;
			removed: number;
	  }
	| {
			path: string;
			staged: boolean;
			kind: 'none' | 'binary' | 'too-large';
			reason: string;
	  };

// The agent's own lines in one file touched by the last turn, or the reason they cannot be told apart (GIT-10).
export type AgentDiff =
	| {
			path: string;
			kind: 'text';
			diff: string;
			added: number;
			removed: number;
	  }
	| {path: string; kind: 'none' | 'fallback'; reason: string};

export interface ReviewRequests {
	status: {projectId: string};
	diff: {projectId: string; path: string; staged: boolean};
	agentDiff: {projectId: string; path: string};
}

export interface ReviewValues {
	status: ReviewStatus;
	diff: ReviewDiff;
	agentDiff: AgentDiff;
}

export type ReviewApi = {
	[K in keyof ReviewRequests]: (
		request: ReviewRequests[K],
	) => Promise<IpcResult<ReviewValues[K]>>;
};
