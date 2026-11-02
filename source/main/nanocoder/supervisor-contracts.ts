import type {NanocoderConnection} from '@/main/nanocoder/acp-client';
import type {
	CapabilityGates,
	DiagnosticsSnapshot,
	ProjectEvent,
	ProjectInfo,
	SupervisorState,
} from '@/shared/ipc';

// One connection per main-owned project, always launched at its canonical root.
export interface NanocoderSupervisor {
	ensureProcess(project: ProjectInfo): Promise<SupervisorState>;
	getState(projectId: string): SupervisorState;
	getConnection(projectId: string): NanocoderConnection;
	stop(projectId: string): Promise<SupervisorState>;
	restart(project: ProjectInfo): Promise<SupervisorState>;
	getCapabilityGates(projectId: string): CapabilityGates;
	getDiagnostics(projectId: string): DiagnosticsSnapshot;
	subscribe(listener: (event: ProjectEvent) => void): () => void;
	close(): Promise<void>;
}
