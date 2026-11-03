interface TerminalDisplay {
	options: {screenReaderMode?: boolean};
	reset(): void;
	write(data: string, callback: () => void): void;
}

export class TerminalOutput {
	private desired = '';
	private rendered = '';
	private writing = false;
	private disposed = false;

	constructor(private readonly terminal: TerminalDisplay) {}

	update(output: string): void {
		this.desired = output;
		this.paint();
	}

	dispose(): void {
		this.disposed = true;
		this.desired = this.rendered = '';
	}

	private paint(): void {
		if (this.disposed || this.writing || this.desired === this.rendered) return;
		const append = this.desired.startsWith(this.rendered);
		const data = append
			? this.desired.slice(this.rendered.length)
			: this.desired;
		if (!append) {
			const screenReader = this.terminal.options.screenReaderMode;
			// xterm reset does not discard the accessibility announcement queue.
			this.terminal.options.screenReaderMode = false;
			this.terminal.reset();
			this.terminal.options.screenReaderMode = screenReader;
		}
		this.rendered = this.desired;
		if (!data) return;
		this.writing = true;
		this.terminal.write(data, () => {
			this.writing = false;
			this.paint();
		});
	}
}
