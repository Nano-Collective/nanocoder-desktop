export class Scrollback {
	private text = '';
	private lost = false;

	constructor(
		private readonly maxChars = 1_048_576,
		private readonly maxLines = 10_000,
	) {}

	append(data: string): void {
		this.text += data;
		if (this.text.length > this.maxChars) {
			this.text = this.text.slice(-this.maxChars);
			if (/^[\uDC00-\uDFFF]/u.test(this.text)) this.text = this.text.slice(1);
			this.lost = true;
		}
		const lines = this.text.split('\n');
		if (lines.length > this.maxLines) {
			this.text = lines.slice(-this.maxLines).join('\n');
			this.lost = true;
		}
	}

	clear(): void {
		this.text = '';
		this.lost = false;
	}

	snapshot(): {output: string; truncated: boolean} {
		return {output: this.text, truncated: this.lost};
	}
}
