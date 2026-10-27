const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_LINE_LENGTH = 4096;
const REDACTED = '[redacted]';

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`],
	[
		/\b(authorization["']?\s*[:=]\s*["']?)(?:[a-z]+\s+)?[^\s"',;]+/gi,
		`$1${REDACTED}`,
	],
	[/\bbearer\s+[\w.~+/=-]+/gi, `Bearer ${REDACTED}`],
	[
		/\b([\w-]*(?:api[_-]?key|token|secret|password|passwd|credential)[\w-]*["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
		`$1${REDACTED}`,
	],
	[
		/\b(?:sk-[\w-]{16,}|gh[opsur]_\w{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abposr]-[\w-]{10,}|AKIA[\dA-Z]{16}|AIza[\w-]{35})/g,
		REDACTED,
	],
];

function replaceAll(
	text: string,
	needle: string,
	replacement: string,
	ignoreCase: boolean,
): string {
	const matches = (candidate: string) =>
		candidate === needle ||
		(ignoreCase && candidate.toLowerCase() === needle.toLowerCase());
	let result = '';
	let from = 0;
	let at = 0;
	while (at <= text.length - needle.length) {
		if (matches(text.slice(at, at + needle.length))) {
			result += text.slice(from, at) + replacement;
			at += needle.length;
			from = at;
		} else {
			at++;
		}
	}
	return result + text.slice(from);
}

export function redact(
	text: string,
	homeDir?: string,
	platform: NodeJS.Platform = process.platform,
): string {
	let result = text;
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	if (homeDir && homeDir.length > 1) {
		const ignoreCase = platform === 'win32' || platform === 'darwin';
		result = replaceAll(result, homeDir, '~', ignoreCase);
	}
	return result;
}

function truncate(line: string): string {
	return line.length > MAX_LINE_LENGTH
		? `${line.slice(0, MAX_LINE_LENGTH)} [truncated]`
		: line;
}

// Lines are redacted whole, so a secret split across two chunks is still caught.
export class StderrRing {
	private readonly entries: string[] = [];
	private bytes = 0;
	private partial = '';

	constructor(
		private readonly options: {maxBytes?: number; homeDir?: string} = {},
	) {}

	write(chunk: string): void {
		const parts = (this.partial + chunk).split(/\r?\n/);
		this.partial = parts.pop() ?? '';
		for (const line of parts) {
			this.append(line);
		}
		if (this.partial.length > MAX_LINE_LENGTH) {
			this.append(this.partial);
			this.partial = '';
		}
	}

	flush(): void {
		if (this.partial) {
			this.append(this.partial);
			this.partial = '';
		}
	}

	append(line: string): void {
		if (line.trim() === '') return;
		const entry = redact(truncate(line), this.options.homeDir);
		this.entries.push(entry);
		this.bytes += Buffer.byteLength(entry);
		const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
		while (this.bytes > maxBytes && this.entries.length > 1) {
			this.bytes -= Buffer.byteLength(this.entries.shift() ?? '');
		}
	}

	lines(): readonly string[] {
		return [...this.entries];
	}
}
