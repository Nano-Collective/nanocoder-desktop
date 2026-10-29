import {randomUUID} from 'node:crypto';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {DiagnosticsService} from '@/main/ipc/workspace-services';
import {type SupervisorClock, systemClock} from '@/main/nanocoder/clock';
import type {DiagnosticsSnapshot} from '@/shared/ipc';

const privateField =
	/^(?:env|environment|prompt|messages?|transcript|content|arguments|input|output|result|tool.*)$/i;

export function diagnosticLine(line: string): string {
	if (line.startsWith('[stdout]')) return '[private payload omitted]';
	const start = line.indexOf('{');
	if (start !== -1) {
		try {
			const pending: unknown[] = [JSON.parse(line.slice(start))];
			while (pending.length) {
				const value = pending.pop();
				if (typeof value !== 'object' || value === null) continue;
				for (const [key, child] of Object.entries(value)) {
					if (privateField.test(key)) return '[private payload omitted]';
					pending.push(child);
				}
			}
		} catch {
			return '[private payload omitted]';
		}
	}
	if (
		/\b(?:env|environment|prompt|messages?|transcript|content|tool[_ -]?(?:input|output|result)|user|assistant)["']?\s*[:=]/i.test(
			line,
		)
	)
		return '[private payload omitted]';
	return line;
}

export class DiagnosticSnapshots {
	private readonly snapshots = new Map<
		string,
		{snapshot: DiagnosticsSnapshot; expiresAt: number}
	>();
	constructor(
		private readonly options: {
			clock?: SupervisorClock;
			maxSnapshots?: number;
			maxBytes?: number;
			ttlMs?: number;
		} = {},
	) {}

	private purge(): void {
		const now = (this.options.clock ?? systemClock).now();
		for (const [id, captured] of this.snapshots) {
			if (captured.expiresAt <= now) this.snapshots.delete(id);
		}
	}

	capture(
		projectId: string,
		lines: readonly string[],
		truncated: boolean,
	): DiagnosticsSnapshot {
		this.purge();
		const bounded = [...lines];
		let bytes = Buffer.byteLength(bounded.join('\n'));
		while (bytes > (this.options.maxBytes ?? 256 * 1024)) {
			const removed = bounded.shift();
			if (removed === undefined) break;
			bytes -= Buffer.byteLength(removed) + (bounded.length ? 1 : 0);
			truncated = true;
		}
		const snapshot = {id: randomUUID(), projectId, lines: bounded, truncated};
		while (this.snapshots.size >= (this.options.maxSnapshots ?? 8)) {
			const oldest = this.snapshots.keys().next().value;
			if (oldest === undefined) break;
			this.snapshots.delete(oldest);
		}
		this.snapshots.set(snapshot.id, {
			snapshot,
			expiresAt:
				(this.options.clock ?? systemClock).now() +
				(this.options.ttlMs ?? 600_000),
		});
		return structuredClone(snapshot);
	}

	get(projectId: string, snapshotId: string): DiagnosticsSnapshot {
		this.purge();
		const snapshot = this.snapshots.get(snapshotId)?.snapshot;
		if (!snapshot || snapshot.projectId !== projectId)
			throw new IpcFailure(
				'NOT_FOUND',
				'Capture diagnostics again before exporting',
			);
		return structuredClone(snapshot);
	}
}

export class DiagnosticsExporter implements DiagnosticsService {
	private exporting = false;
	constructor(
		private readonly options: {
			read(projectId: string, snapshotId: string): DiagnosticsSnapshot;
			review(snapshot: DiagnosticsSnapshot): Promise<boolean>;
			chooseDestination(): Promise<string | undefined>;
			write(destination: string, contents: string): Promise<void>;
		},
	) {}

	async exportDiagnostics(request: {
		projectId: string;
		snapshotId: string;
	}): Promise<{status: 'exported' | 'cancelled'}> {
		if (this.exporting)
			throw new IpcFailure('BUSY', 'A diagnostics export is already open');
		this.exporting = true;
		try {
			const snapshot = this.options.read(request.projectId, request.snapshotId);
			if (!(await this.options.review(structuredClone(snapshot))))
				return {status: 'cancelled'};
			this.options.read(request.projectId, request.snapshotId);
			const destination = await this.options.chooseDestination();
			if (!destination) return {status: 'cancelled'};
			this.options.read(request.projectId, request.snapshotId);
			await this.options.write(destination, snapshot.lines.join('\n'));
			return {status: 'exported'};
		} catch (error) {
			if (error instanceof IpcFailure) throw error;
			throw new IpcFailure('INTERNAL', 'Diagnostics could not be exported');
		} finally {
			this.exporting = false;
		}
	}
}
