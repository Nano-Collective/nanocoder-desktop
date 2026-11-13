import {relativeSegments} from '@/main/files/safe-path';
import {IpcFailure} from '@/main/ipc/handle-request';
import {
	baselineFor,
	type TimelineEntry,
	type TimelineRead,
} from '@/main/nanocoder/timeline';
import type {AgentDiff, ReviewDiff, TurnReview} from '@/shared/review';

export interface AgentSnapshots {
	list(): Promise<TimelineEntry[]>;
	read(checkpointId: string, path: string): Promise<TimelineRead>;
}

export interface AgentChangesOptions {
	tracker: {latest(projectId: string): TurnReview | null};
	gate(projectId: string): {enabled: boolean; reason: string | null};
	// The live Nanocoder session of the thread that ran the turn, when there is one.
	snapshots(projectId: string, threadId: string): AgentSnapshots | undefined;
	compare(
		projectId: string,
		path: string,
		before: string | null,
	): Promise<ReviewDiff>;
}

// Shows only what the agent changed in a file, by comparing it with the copy Nanocoder took
// before its first edit of the turn (GIT-09). It reads snapshots and never writes one; whenever
// they cannot answer it says why and leaves Git's full diff to the caller (GIT-10).
export class AgentChangesService {
	constructor(private readonly options: AgentChangesOptions) {}

	availability(projectId: string): {enabled: boolean; reason: string | null} {
		return this.options.gate(projectId);
	}

	async diff(request: {projectId: string; path: string}): Promise<AgentDiff> {
		const {projectId, path} = request;
		if (relativeSegments(path).length === 0)
			throw new IpcFailure('VALIDATION', 'Choose a file to compare');
		const fallback = (reason: string): AgentDiff => ({
			path,
			kind: 'fallback',
			reason,
		});
		const gate = this.options.gate(projectId);
		if (!gate.enabled)
			return fallback(gate.reason ?? 'Agent changes are unavailable.');
		const turn = this.options.tracker.latest(projectId);
		if (!turn) return fallback('There has been no turn in this project yet.');
		if (turn.running)
			return fallback(
				'The agent is still working, so every change in the file is shown.',
			);
		if (!turn.touched.includes(path))
			return fallback(
				'The last turn did not edit this file through a tool call, so every change is shown.',
			);
		const snapshots = this.options.snapshots(projectId, turn.threadId);
		if (!snapshots)
			return fallback(
				'Nanocoder no longer has this chat open, so it has no snapshots to read.',
			);
		let entries: TimelineEntry[];
		try {
			entries = await snapshots.list();
		} catch {
			return fallback('Nanocoder could not list its snapshots.');
		}
		const baseline = baselineFor(entries, path);
		if (!baseline)
			return fallback(
				'Nanocoder took no snapshot of this file, for example when a shell command changed it.',
			);
		let before: string | null = null;
		if (!baseline.created) {
			let read: TimelineRead;
			try {
				read = await snapshots.read(baseline.entry.id, path);
			} catch {
				return fallback('Nanocoder could not read its snapshot of this file.');
			}
			if (read.kind === 'unavailable')
				return fallback(
					`Nanocoder has no earlier copy of this file${read.reason ? `: ${read.reason}` : '.'}`,
				);
			before = read.kind === 'text' ? read.content : null;
		}
		const compared = await this.options.compare(projectId, path, before);
		switch (compared.kind) {
			case 'text':
				return {
					path,
					kind: 'text',
					diff: compared.diff,
					added: compared.added,
					removed: compared.removed,
				};
			case 'none':
				return {path, kind: 'none', reason: compared.reason};
			default:
				return fallback(compared.reason);
		}
	}
}
