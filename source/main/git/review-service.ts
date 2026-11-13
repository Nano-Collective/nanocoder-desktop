import type {AgentChangesService} from '@/main/git/agent-changes';
import type {GitService} from '@/main/git/git-service';
import type {TurnTracker} from '@/main/git/turn-tracker';
import type {AgentDiff, ReviewDiff, ReviewStatus} from '@/shared/review';

// Joins Git's view of the work tree with the turn tracker's labels (GIT-05).
export class ReviewService {
	constructor(
		private readonly git: GitService,
		private readonly tracker: TurnTracker,
		private readonly agent: AgentChangesService,
	) {}

	async status(request: {projectId: string}): Promise<ReviewStatus> {
		const status = await this.git.status(request.projectId);
		if (!status.available) return {available: false, reason: status.reason};
		const turn = this.tracker.latest(request.projectId);
		const touched = new Set(turn?.touched ?? []);
		return {
			available: true,
			git: status.git,
			head: status.head,
			branch: status.branch,
			entries: status.entries.map(entry => ({
				...entry,
				touched: touched.has(entry.path),
			})),
			notShown: status.notShown,
			turn,
			agentChanges: this.agent.availability(request.projectId),
		};
	}

	agentDiff(request: {projectId: string; path: string}): Promise<AgentDiff> {
		return this.agent.diff(request);
	}

	diff(request: {
		projectId: string;
		path: string;
		staged: boolean;
	}): Promise<ReviewDiff> {
		return this.git.diff(request.projectId, request.path, request.staged);
	}
}
