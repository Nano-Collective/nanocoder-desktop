import {stat} from 'node:fs/promises';
import {IpcFailure} from '@/main/ipc/handle-request';
import {canonicalPath} from '@/main/paths';
import type {PtyHost, PtyHostFactory} from '@/main/terminal/pty-contracts';
import {Scrollback} from '@/main/terminal/scrollback';
import {discoverShell, terminalEnvironment} from '@/main/terminal/shell';
import type {ProjectInfo} from '@/shared/ipc';
import type {
	AgentCommandInfo,
	TerminalEvent,
	TerminalRequests,
	TerminalSnapshot,
} from '@/shared/terminal';

export class TerminalService {
	private activeId: string | null = null;
	private closed = false;
	private queue: Promise<unknown> = Promise.resolve();
	private host: PtyHost | undefined;
	private generation = 0;
	private readonly buffer = new Scrollback();
	private state: TerminalSnapshot = {
		projectId: '',
		sequence: 0,
		status: 'stopped',
		shell: null,
		cols: 80,
		rows: 24,
		output: '',
		truncated: false,
		exitCode: null,
		reason: null,
		agentCommand: null,
	};

	constructor(
		private readonly options: {
			project(id: string): ProjectInfo | undefined;
			projects(): readonly ProjectInfo[];
			createHost: PtyHostFactory;
			emit(event: TerminalEvent): void;
			shell?: typeof discoverShell;
			env?: NodeJS.ProcessEnv;
		},
	) {}

	activate(projectId: string | null): Promise<void> {
		this.activeId = projectId;
		++this.generation;
		return this.serial(async () => {
			await this.stopHost();
			this.state = {
				...this.state,
				projectId: projectId ?? '',
				shell: null,
				agentCommand: null,
				sequence: this.state.sequence + 1,
			};
			this.publish();
		});
	}

	get({projectId}: TerminalRequests['get']): TerminalSnapshot {
		this.check(projectId);
		return {...this.state, ...this.buffer.snapshot()};
	}

	start(request: TerminalRequests['start']): Promise<TerminalSnapshot> {
		const generation = this.generation;
		return this.serial(async () => {
			const project = this.check(request.projectId, true);
			if (generation !== this.generation) throw this.changed();
			if (this.host) return this.get(request);
			await this.validate(project);
			const roots = this.options.projects().map(value => value.canonicalRoot);
			const shell = await (this.options.shell ?? discoverShell)({roots});
			await this.validate(project);
			if (generation !== this.generation) throw this.changed();
			this.check(project.id, true);
			this.buffer.clear();
			this.state = {
				...this.state,
				status: 'starting',
				shell: shell.file,
				exitCode: null,
				reason: null,
			};
			this.publish();
			try {
				const host = await this.options.createHost(
					{
						root: project.canonicalRoot,
						roots,
						shell,
						env: terminalEnvironment(this.options.env ?? process.env),
						cols: this.state.cols,
						rows: this.state.rows,
					},
					{
						data: data => {
							if (generation !== this.generation || this.closed) return;
							this.buffer.append(data);
							this.options.emit({
								type: 'data',
								projectId: project.id,
								sequence: ++this.state.sequence,
								data,
							});
						},
						exit: (code, failed) => {
							if (generation !== this.generation || this.closed) return;
							if (!failed) this.host = undefined;
							this.state.status = failed ? 'failed' : 'exited';
							this.state.exitCode = code;
							this.state.reason = failed
								? 'The terminal process ended unexpectedly'
								: null;
							this.publish();
						},
					},
				);
				if (generation !== this.generation || this.closed) {
					await host.stop();
					throw this.changed();
				}
				this.host = host;
				this.state.status = 'running';
				this.publish();
				return this.get(request);
			} catch {
				this.state.status = 'failed';
				this.state.reason = 'The terminal could not start';
				this.publish();
				throw new IpcFailure('UNAVAILABLE', 'The terminal could not start');
			}
		});
	}

	stop(request: TerminalRequests['stop']): Promise<TerminalSnapshot> {
		this.check(request.projectId);
		++this.generation;
		return this.serial(async () => {
			await this.stopHost();
			this.publish();
			return this.get(request);
		});
	}

	async restart(
		request: TerminalRequests['restart'],
	): Promise<TerminalSnapshot> {
		await this.stop(request);
		return this.start(request);
	}

	write(request: TerminalRequests['write']): TerminalSnapshot {
		this.check(request.projectId, true);
		if (!this.host || this.state.status !== 'running')
			throw new IpcFailure('UNAVAILABLE', 'Start the terminal before typing');
		if (request.data.length > 65_536 || request.data.length === 0)
			throw new IpcFailure('LIMIT', 'Terminal input is too large');
		this.host.write(request.data);
		return this.get(request);
	}

	resize(request: TerminalRequests['resize']): TerminalSnapshot {
		this.check(request.projectId, true);
		if (
			![request.cols, request.rows].every(
				value => Number.isInteger(value) && value >= 2 && value <= 500,
			)
		)
			throw new IpcFailure('VALIDATION', 'Invalid terminal dimensions');
		this.host?.resize(request.cols, request.rows);
		this.state.cols = request.cols;
		this.state.rows = request.rows;
		this.publish();
		return this.get(request);
	}

	clear(request: TerminalRequests['clear']): TerminalSnapshot {
		this.check(request.projectId);
		this.host?.clear();
		this.buffer.clear();
		this.publish();
		return this.get(request);
	}

	setAgentCommand(projectId: string, command: AgentCommandInfo): void {
		if (projectId !== this.activeId || this.closed) return;
		this.state.agentCommand = {...command};
		this.publish();
	}

	close(): Promise<void> {
		this.closed = true;
		++this.generation;
		return this.serial(() => this.stopHost());
	}

	private async validate(project: ProjectInfo): Promise<void> {
		try {
			const root = await canonicalPath(project.canonicalRoot);
			if (
				root !== project.canonicalRoot ||
				root !== project.sessionCwd ||
				!(await stat(root)).isDirectory()
			)
				throw new Error();
			const current = this.check(project.id, true);
			if (current.canonicalRoot !== root || current.sessionCwd !== root)
				throw new Error();
		} catch {
			throw new IpcFailure(
				'DENIED',
				'The project folder changed; open it again',
			);
		}
	}

	private check(id: string, trusted = false): ProjectInfo {
		if (this.closed || id !== this.activeId || id !== this.state.projectId)
			throw this.changed();
		const project = this.options.project(id);
		if (!project) throw new IpcFailure('NOT_FOUND', 'Project not found');
		if (trusted && (!project.trusted || project.availability !== 'available'))
			throw new IpcFailure(
				'DENIED',
				'Trust and open the project before using its terminal',
			);
		return project;
	}

	private changed(): IpcFailure {
		return new IpcFailure(
			'DENIED',
			'The terminal belongs to the active project only',
		);
	}

	private async stopHost(): Promise<void> {
		try {
			await this.host?.stop();
			this.host = undefined;
			this.state.status = 'stopped';
			this.state.reason = null;
			this.state.exitCode = null;
			this.buffer.clear();
		} catch {
			this.state.status = 'failed';
			this.state.reason = 'The terminal process tree could not be stopped';
			this.publish();
			throw new IpcFailure('UNAVAILABLE', this.state.reason);
		}
	}

	private publish(): void {
		++this.state.sequence;
		this.options.emit({
			type: 'snapshot',
			snapshot: {...this.state, ...this.buffer.snapshot()},
		});
	}

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(work);
		this.queue = result.catch(() => {});
		return result;
	}
}
