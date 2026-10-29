import {z} from 'zod';
import type {StreamMetadata} from '@/shared/ipc';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usage = z
	.object({
		inputTokens: count.optional(),
		outputTokens: count.optional(),
		totalTokens: count.optional(),
		thoughtTokens: count.optional(),
		cachedReadTokens: count.optional(),
		cachedWriteTokens: count.optional(),
		cost: amount.optional(),
	})
	.refine(value => Object.keys(value).length > 0);
const artifacts = z
	.array(
		z.object({
			kind: z.enum(['implementation_plan', 'task', 'walkthrough']),
			path: z
				.string()
				.min(1)
				.max(4096)
				.refine(value => !value.includes('\0')),
		}),
	)
	.max(64);

export type MetadataField =
	| '_meta'
	| 'usage'
	| 'nanocoder/usage'
	| 'nanocoder/response-usage'
	| 'nanocoder/durationMs'
	| 'nanocoder/outcome'
	| 'nanocoder/artifacts';

export type MetadataWarning = (field: MetadataField) => void;

const warn: MetadataWarning = field =>
	console.warn('Ignored malformed ACP metadata:', field);

export function parseTurnMetadata(
	input: unknown,
	report: MetadataWarning = warn,
): StreamMetadata | undefined {
	if (input === undefined || input === null) return undefined;
	if (typeof input !== 'object' || Array.isArray(input)) {
		report('_meta');
		return undefined;
	}
	const data = input as Record<string, unknown>;
	const result: StreamMetadata = {};
	const read = <T>(key: MetadataField, schema: z.ZodType<T>): T | undefined => {
		if (!Object.hasOwn(data, key)) return undefined;
		const parsed = schema.safeParse(data[key]);
		if (parsed.success) return parsed.data;
		report(key);
		return undefined;
	};
	const turnUsage = read('nanocoder/usage', usage);
	const responseUsage = read('nanocoder/response-usage', usage);
	if (turnUsage || responseUsage)
		result.usage = {...turnUsage, ...responseUsage};
	const durationMs = read('nanocoder/durationMs', amount);
	if (durationMs !== undefined) result.durationMs = durationMs;
	const outcome = read(
		'nanocoder/outcome',
		z.enum(['completed', 'cancelled', 'failed']),
	);
	if (outcome !== undefined) result.outcome = outcome;
	const reportedArtifacts = read('nanocoder/artifacts', artifacts);
	if (reportedArtifacts !== undefined) result.artifacts = reportedArtifacts;
	return Object.keys(result).length ? result : undefined;
}

export function parsePromptMetadata(
	response: {usage?: unknown; _meta?: unknown},
	report: MetadataWarning = warn,
): StreamMetadata | undefined {
	const metadata = parseTurnMetadata(response._meta, report);
	if (response.usage === undefined || response.usage === null) return metadata;
	const parsed = usage.safeParse(response.usage);
	if (!parsed.success) {
		report('usage');
		return metadata;
	}
	return {...metadata, usage: {...metadata?.usage, ...parsed.data}};
}
