import path from 'node:path';
import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import {subagentLabel} from '@/shared/subagents';

// SQLite replaces unpaired surrogates instead of preserving opaque IDs.
export const boundedIdentity = (maxBytes: number) =>
	z
		.string()
		.refine(
			value => !!subagentLabel(value, maxBytes) && !/\p{Cs}/u.test(value),
		);
export const nanocoderSessionIdSchema = boundedIdentity(200);

export const mode = z.enum([
	'normal',
	'auto-accept',
	'plan',
	'architect',
	'yolo',
]);
export const defaultMode = mode.exclude(['yolo']);
const id = z.uuid();
const timestamp = z.iso
	.datetime()
	.transform(value => new Date(value).toISOString());
const absolutePath = z
	.string()
	.min(1)
	.max(32_768)
	.refine(value => !value.includes('\0') && path.isAbsolute(value));

export const settingsPatch = z.strictObject({
	publicBrowsingEnabled: z.boolean().optional(),
	defaultMode: defaultMode.optional(),
	editor: z.enum(['system', 'code', 'cursor', 'zed']).optional(),
	theme: z.enum(['dark', 'light', 'system']).optional(),
	nanocoderBrowserEnabled: z.boolean().optional(),
});

const profileName = z
	.string()
	.trim()
	.min(1)
	.max(40)
	.refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const browserProfiles = z
	.array(z.strictObject({id: z.uuid(), name: profileName}))
	.max(20)
	.refine(
		list =>
			new Set(list.map(entry => entry.id)).size === list.length &&
			new Set(list.map(entry => entry.name.toLowerCase())).size === list.length,
	);
const browserAssignments = z
	.record(
		z.uuid(),
		z.union([
			z.literal('project'),
			z.literal('default'),
			z.literal('incognito'),
			z.uuid(),
		]),
	)
	.refine(record => Object.keys(record).length <= 500);

export const settingsSchema = settingsPatch
	.required()
	.extend({
		nanocoderOverridePath: absolutePath.nullable(),
		browserProfiles,
		browserAssignments,
	})
	.refine(settings => {
		const known = new Set(settings.browserProfiles.map(entry => entry.id));
		return Object.values(settings.browserAssignments).every(
			value =>
				value === 'project' ||
				value === 'default' ||
				value === 'incognito' ||
				known.has(value),
		);
	});

export const uiPatch = z.strictObject({
	window: z
		.strictObject({
			width: z.number().int().min(400).max(16_384),
			height: z.number().int().min(300).max(16_384),
			x: z.number().int().min(-65_536).max(65_536).nullable(),
			y: z.number().int().min(-65_536).max(65_536).nullable(),
			maximised: z.boolean(),
		})
		.optional(),
	activeProjectId: id.nullable().optional(),
	activeThreadId: id.nullable().optional(),
	openThreadIds: z.array(id).max(100).optional(),
	inspector: z.enum(['files', 'review', 'browser']).nullable().optional(),
	bottomPanel: z.enum(['terminal', 'browser']).nullable().optional(),
});

export const uiSchema = uiPatch.required();

export const projectSchema = z.strictObject({
	id,
	canonicalRoot: absolutePath,
	sessionCwd: absolutePath,
	displayName: z.string().min(1).max(500),
	trusted: z.boolean(),
	defaultMode,
	lastOpenedAt: timestamp,
	createdAt: timestamp,
	availability: z.enum(['available', 'missing', 'changed']),
});

export const threadSchema = z.strictObject({
	id,
	projectId: id,
	nanocoderSessionId: nanocoderSessionIdSchema.nullable(),
	title: z.string().min(1).max(500),
	archiveState: z.enum(['active', 'archived']),
	runState: z.enum([
		'new',
		'ready',
		'running',
		'waiting-approval',
		'interrupted',
		'failed',
		'view-only',
	]),
	lastActivityAt: timestamp,
	sessionCwd: absolutePath,
	mode,
	viewOnlyReason: z.string().max(1_000).nullable(),
});

export const threadTitleTarget = z.strictObject({projectId: id, threadId: id});
export const threadTitlePatch = threadTitleTarget.extend({
	title: z.string().trim().min(1).max(500),
	manuallySet: z.boolean(),
});

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new IpcFailure('VALIDATION', 'Invalid desktop metadata');
	}
	return parsed.data;
}
