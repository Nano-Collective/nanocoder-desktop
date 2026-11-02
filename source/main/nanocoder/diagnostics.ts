import {randomUUID} from 'node:crypto';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {DiagnosticsService} from '@/main/ipc/workspace-services';
import {type SupervisorClock, systemClock} from '@/main/nanocoder/clock';
import type {
	DiagnosticsSnapshot,
	WorkspaceRequests,
	WorkspaceValues,
} from '@/shared/ipc';

const methods = new Set([
	'initialize',
	'session/new',
	'session/resume',
	'session/set_mode',
	'session/close',
	'session/cancel',
	'session/prompt',
]);

export function diagnosticLine(line: string, expectedRoot?: string): string {
	if (line === '[overlong stderr line omitted]') return line;
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			const metadata = value as Record<string, unknown>;
			if (typeof metadata.method === 'string' && methods.has(metadata.method))
				return JSON.stringify({method: metadata.method});
			if (
				metadata.started === true &&
				typeof metadata.pid === 'number' &&
				Number.isSafeInteger(metadata.pid) &&
				metadata.pid > 0 &&
				expectedRoot !== undefined &&
				metadata.cwd === expectedRoot
			)
				return JSON.stringify({
					started: true,
					pid: metadata.pid,
					cwd: expectedRoot,
				});
			if (metadata.stdinClosed === true) return '{"stdinClosed":true}';
		}
	} catch {}
	return '[private payload omitted]';
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

	async exportDiagnostics(
		request: WorkspaceRequests['exportDiagnostics'],
	): Promise<WorkspaceValues['exportDiagnostics']> {
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
