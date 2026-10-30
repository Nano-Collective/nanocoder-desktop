import type {
	DesktopSettings,
	ProjectInfo,
	ThreadInfo,
	UiState,
	UiStatePatch,
} from '@/shared/ipc';

export type SqlValue = string | number | bigint | Uint8Array | null;

export interface SqlStatement {
	run(...values: SqlValue[]): {changes: number | bigint};
	get(...values: SqlValue[]): Record<string, SqlValue> | undefined;
	all(...values: SqlValue[]): Record<string, SqlValue>[];
}

// No node:sqlite or better-sqlite3 types cross this seam (DEC-04).
export interface SqlDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqlStatement;
	close(): void;
}

export interface SqlDriver {
	open(absolutePath: string): SqlDatabase;
	backup(database: SqlDatabase, absolutePath: string): Promise<void>;
}

export interface StoreOptions {
	databasePath: string;
	driver: SqlDriver;
}

export interface ProjectRepository {
	list(): ProjectInfo[];
	get(id: string): ProjectInfo | undefined;
	save(project: ProjectInfo): void;
	remove(id: string): void;
}

export interface ThreadRepository {
	list(
		projectId: string,
		archiveState: ThreadInfo['archiveState'],
	): ThreadInfo[];
	get(projectId: string, threadId: string): ThreadInfo | undefined;
	getTitleManuallySet(projectId: string, threadId: string): boolean | undefined;
	setTitle(input: {
		projectId: string;
		threadId: string;
		title: string;
		manuallySet: boolean;
	}): ThreadInfo;
	save(thread: ThreadInfo): void;
	remove(projectId: string, threadId: string): void;
}

export interface DesktopStore {
	getSettings(): DesktopSettings;
	updateSettings(patch: Partial<DesktopSettings>): DesktopSettings;
	getUiState(): UiState;
	updateUiState(patch: UiStatePatch): UiState;
	projects: ProjectRepository;
	threads: ThreadRepository;
	close(): void;
}

export interface DesktopStoreFactory {
	open(options: StoreOptions): Promise<DesktopStore>;
}
