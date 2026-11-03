import type {ChangeState} from '@/shared/review';

export interface ParsedEntry {
	path: string;
	oldPath: string | null;
	staged: ChangeState;
	unstaged: ChangeState;
	untracked: boolean;
	conflicted: boolean;
}

export interface ParsedStatus {
	head: string | null;
	branch: string | null;
	entries: ParsedEntry[];
	// Ignored paths; a trailing '/' marks a whole ignored folder.
	ignored: string[];
}

const STATE: Record<string, ChangeState> = {
	'.': 'none',
	M: 'modified',
	T: 'modified',
	A: 'added',
	D: 'deleted',
	R: 'renamed',
	C: 'renamed',
};

const state = (code: string): ChangeState => STATE[code] ?? 'modified';

// `git status --porcelain=v2 -z --branch`: records end in NUL, so names may
// hold spaces, newlines or quotes. A rename or copy ("2") is followed by one
// extra NUL-terminated field holding the original path.
export function parseStatus(output: Buffer): ParsedStatus {
	const fields = output.toString('utf8').split('\u0000');
	const result: ParsedStatus = {
		head: null,
		branch: null,
		entries: [],
		ignored: [],
	};
	for (let index = 0; index < fields.length; index++) {
		const record = fields[index];
		if (!record) continue;
		const kind = record[0];
		if (kind === '#') {
			const header = /^# branch\.(oid|head) (.*)$/u.exec(record);
			if (header?.[1] === 'oid')
				result.head = header[2] === '(initial)' ? null : header[2];
			else if (header?.[1] === 'head')
				result.branch = header[2] === '(detached)' ? null : header[2];
		} else if (kind === '1') {
			const parts = record.split(' ');
			const path = parts.slice(8).join(' ');
			if (parts.length >= 9)
				result.entries.push({
					path,
					oldPath: null,
					staged: state(parts[1][0]),
					unstaged: state(parts[1][1]),
					untracked: false,
					conflicted: false,
				});
		} else if (kind === '2') {
			const parts = record.split(' ');
			const path = parts.slice(9).join(' ');
			const oldPath = fields[++index] ?? null;
			if (parts.length >= 10)
				result.entries.push({
					path,
					oldPath,
					staged: state(parts[1][0]),
					unstaged: state(parts[1][1]),
					untracked: false,
					conflicted: false,
				});
		} else if (kind === 'u') {
			const parts = record.split(' ');
			if (parts.length >= 11)
				result.entries.push({
					path: parts.slice(10).join(' '),
					oldPath: null,
					staged: 'none',
					unstaged: 'modified',
					untracked: false,
					conflicted: true,
				});
		} else if (kind === '?' && record[1] === ' ' && record.length > 2) {
			result.entries.push({
				path: record.slice(2),
				oldPath: null,
				staged: 'none',
				unstaged: 'none',
				untracked: true,
				conflicted: false,
			});
		} else if (kind === '!' && record[1] === ' ' && record.length > 2) {
			result.ignored.push(record.slice(2));
		}
	}
	return result;
}
