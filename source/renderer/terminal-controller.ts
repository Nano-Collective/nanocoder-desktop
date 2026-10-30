import type {
	TerminalApi,
	TerminalEvent,
	TerminalSnapshot,
} from '@/shared/terminal';

export type TerminalAction = 'start' | 'stop' | 'restart' | 'clear';
export interface TerminalState {
	projectId: string | null;
	snapshot: TerminalSnapshot | null;
	loading: boolean;
	pending: boolean;
	error: string | null;
}

export function boundTerminalOutput(output: string): string {
	let start = Math.max(0, output.length - 1_048_576);
	let lines = 0;
	for (let i = output.length - 1; i >= start; --i) {
		if (output[i] === '\n' && ++lines >= 10_000) {
			start = i + 1;
			break;
		}
	}
	if (/^[\uDC00-\uDFFF]$/u.test(output[start] ?? '')) ++start;
	return output.slice(start);
}

export class TerminalController {
	private state: TerminalState = {
		projectId: null,
		snapshot: null,
		loading: false,
		pending: false,
		error: null,
	};
	private epoch = 0;
	private disposed = false;
	private readonly unsubscribe: () => void;
	private early: Extract<TerminalEvent, {type: 'data'}>[] = [];
	private earlySize = 0;

	constructor(
		private readonly bridge: TerminalApi,
		private readonly changed: (state: TerminalState) => void,
	) {
		this.unsubscribe = bridge.onEvent(event => this.receive(event));
	}

	getState(): TerminalState {
		return this.state;
	}

	async select(projectId: string | null): Promise<void> {
		const epoch = ++this.epoch;
		this.early = [];
		this.earlySize = 0;
		this.update({
			projectId,
			snapshot: null,
			loading: projectId !== null,
			pending: false,
			error: null,
		});
		if (!projectId) return;
		try {
			const result = await this.bridge.get({projectId});
			if (!this.current(epoch)) return;
			if (result.ok) {
				this.snapshot(result.value);
				const queued = this.early;
				this.early = [];
				for (const event of queued) this.receive(event);
			} else this.update({error: result.error.message});
		} catch {
			if (this.current(epoch))
				this.update({error: 'The terminal could not be loaded'});
		} finally {
			if (this.current(epoch)) this.update({loading: false});
		}
	}

	async action(action: TerminalAction): Promise<boolean> {
		const {projectId, pending} = this.state;
		if (!projectId || pending || this.disposed) return false;
		const epoch = this.epoch;
		this.update({pending: true, error: null});
		try {
			const result = await this.bridge[action]({projectId});
			if (!this.current(epoch)) return false;
			if (!result.ok) {
				this.update({error: result.error.message});
				return false;
			}
			this.snapshot(result.value);
			return true;
		} catch {
			if (this.current(epoch))
				this.update({error: 'The terminal request failed'});
			return false;
		} finally {
			if (this.current(epoch)) this.update({pending: false});
		}
	}

	async write(data: string): Promise<void> {
		const {projectId, snapshot, pending} = this.state;
		if (
			!projectId ||
			snapshot?.status !== 'running' ||
			pending ||
			this.disposed
		)
			return;
		if (!data.length || data.length > 65_536) {
			this.update({
				error: 'Terminal input must contain between 1 and 65,536 code units',
			});
			return;
		}
		const epoch = this.epoch;
		try {
			const result = await this.bridge.write({projectId, data});
			if (this.current(epoch) && !result.ok)
				this.update({error: result.error.message});
		} catch {
			if (this.current(epoch))
				this.update({error: 'Terminal input was not delivered'});
		}
	}

	async resize(cols: number, rows: number): Promise<void> {
		const {projectId, snapshot} = this.state;
		if (
			!projectId ||
			snapshot?.status !== 'running' ||
			this.disposed ||
			(snapshot.cols === cols && snapshot.rows === rows)
		)
			return;
		const epoch = this.epoch;
		try {
			const result = await this.bridge.resize({projectId, cols, rows});
			if (this.current(epoch) && !result.ok)
				this.update({error: result.error.message});
		} catch {
			if (this.current(epoch))
				this.update({error: 'The terminal could not be resized'});
		}
	}

	dispose(): void {
		this.disposed = true;
		++this.epoch;
		this.early = [];
		this.unsubscribe();
	}

	private current(epoch: number): boolean {
		return !this.disposed && epoch === this.epoch;
	}

	private receive(event: TerminalEvent): void {
		if (this.disposed) return;
		if (event.type === 'snapshot') {
			this.snapshot(event.snapshot);
			return;
		}
		if (event.projectId !== this.state.projectId) return;
		const previous = this.state.snapshot;
		if (!previous) {
			if (
				this.early.length < 128 &&
				this.earlySize + event.data.length <= 1_048_576
			) {
				this.early.push(event);
				this.earlySize += event.data.length;
			} else
				this.update({
					error:
						'Terminal output arrived too quickly; close and reopen the project',
				});
			return;
		}
		if (event.sequence <= previous.sequence) return;
		const combined = previous.output + event.data;
		const output = boundTerminalOutput(combined);
		this.update({
			snapshot: {
				...previous,
				sequence: event.sequence,
				output,
				truncated: previous.truncated || output.length < combined.length,
			},
		});
	}

	private snapshot(snapshot: TerminalSnapshot): void {
		if (
			snapshot.projectId !== this.state.projectId ||
			snapshot.sequence <= (this.state.snapshot?.sequence ?? -1)
		)
			return;
		this.update({snapshot});
	}

	private update(patch: Partial<TerminalState>): void {
		if (this.disposed) return;
		this.state = {...this.state, ...patch};
		this.changed(this.state);
	}
}
