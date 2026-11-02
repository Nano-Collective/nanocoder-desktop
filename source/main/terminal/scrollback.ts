function newlines(text: string, end = text.length): number {
	let count = 0;
	for (let i = text.indexOf('\n'); i !== -1 && i < end; ) {
		++count;
		i = text.indexOf('\n', i + 1);
	}
	return count;
}

export class Scrollback {
	private text = '';
	private breaks = 0;
	private lost = false;

	constructor(
		private readonly maxChars = 1_048_576,
		private readonly maxLines = 10_000,
	) {}

	// Trimming scans only what is appended or dropped, never the whole buffer.
	append(data: string): void {
		this.text += data;
		this.breaks += newlines(data);
		if (this.text.length > this.maxChars) {
			let cut = this.text.length - this.maxChars;
			if (/^[\uDC00-\uDFFF]/u.test(this.text[cut] ?? '')) ++cut;
			this.breaks -= newlines(this.text, cut);
			this.text = this.text.slice(cut);
			this.lost = true;
		}
		if (this.breaks >= this.maxLines) {
			let index = -1;
			for (let drop = this.breaks - this.maxLines + 1; drop > 0; --drop)
				index = this.text.indexOf('\n', index + 1);
			this.text = this.text.slice(index + 1);
			this.breaks = this.maxLines - 1;
			this.lost = true;
		}
	}

	clear(): void {
		this.text = '';
		this.breaks = 0;
		this.lost = false;
	}

	snapshot(): {output: string; truncated: boolean} {
		return {output: this.text, truncated: this.lost};
	}
}
