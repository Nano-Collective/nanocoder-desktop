const MAX_ENTRIES = 200;
const MAX_FIELD = 200;
const MAX_PATHS = 2_000;
const MAX_PATH = 4_096;
const MAX_REASON = 500;

export interface TimelineEntry {
	id: string;
	seq: number;
	truncateToMessageIndex: number;
	filesChanged: string[];
	createdFiles: string[];
	turnId?: string;
}

export type TimelineRead =
	| {kind: 'text'; content: string}
	| {kind: 'created'}
	| {kind: 'unavailable'; reason: string};

const record = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const paths = (value: unknown): string[] | undefined =>
	Array.isArray(value) &&
	value.length <= MAX_PATHS &&
	value.every(item => typeof item === 'string' && item.length <= MAX_PATH)
		? (value as string[])
		: undefined;

function entryFrom(value: unknown): TimelineEntry | undefined {
	const raw = record(value);
	if (!raw) return undefined;
	const filesChanged = paths(raw.filesChanged);
	const createdFiles = paths(raw.createdFiles);
	if (
		typeof raw.id !== 'string' ||
		raw.id === '' ||
		raw.id.length > MAX_FIELD ||
		!Number.isInteger(raw.seq) ||
		!Number.isInteger(raw.truncateToMessageIndex) ||
		!filesChanged ||
		!createdFiles
	)
		return undefined;
	const turnId =
		typeof raw.turnId === 'string' && raw.turnId.length <= MAX_FIELD
			? raw.turnId
			: undefined;
	return {
		id: raw.id,
		seq: raw.seq as number,
		truncateToMessageIndex: raw.truncateToMessageIndex as number,
		filesChanged,
		createdFiles,
		...(turnId === undefined ? {} : {turnId}),
	};
}

// A bounded, allowlisted copy of `timeline/list`; anything else Nanocoder adds is dropped.
export function parseTimelineEntries(
	value: unknown,
): TimelineEntry[] | undefined {
	const raw = record(value)?.entries;
	if (!Array.isArray(raw)) return undefined;
	return raw
		.slice(0, MAX_ENTRIES)
		.map(entryFrom)
		.filter((entry): entry is TimelineEntry => entry !== undefined);
}

export function parseTimelineRead(value: unknown): TimelineRead | undefined {
	const raw = record(value);
	if (!raw) return undefined;
	if (raw.kind === 'created') return {kind: 'created'};
	if (raw.kind === 'text' && typeof raw.content === 'string')
		return {kind: 'text', content: raw.content};
	if (raw.kind === 'unavailable')
		return {
			kind: 'unavailable',
			reason:
				typeof raw.reason === 'string' ? raw.reason.slice(0, MAX_REASON) : '',
		};
	return undefined;
}

const normal = (path: string) => path.replaceAll('\\', '/');

// The checkpoint that holds the path as it was before the latest turn touched it:
// the earliest one in the latest group (a turn, or one message index) that includes it.
export function baselineFor(
	entries: readonly TimelineEntry[],
	path: string,
): {entry: TimelineEntry; created: boolean} | undefined {
	const target = normal(path);
	const touching = entries.filter(entry =>
		entry.filesChanged.some(changed => normal(changed) === target),
	);
	if (touching.length === 0) return undefined;
	const latest = touching.reduce((best, entry) =>
		entry.seq > best.seq ? entry : best,
	);
	const group = touching.filter(entry =>
		latest.turnId !== undefined || entry.turnId !== undefined
			? entry.turnId === latest.turnId
			: entry.truncateToMessageIndex === latest.truncateToMessageIndex,
	);
	const earliest = group.reduce((best, entry) =>
		entry.seq < best.seq ? entry : best,
	);
	return {
		entry: earliest,
		created: earliest.createdFiles.some(created => normal(created) === target),
	};
}
