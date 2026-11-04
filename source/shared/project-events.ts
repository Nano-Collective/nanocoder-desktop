import {z} from 'zod';
import type {ProjectEvent} from '@/shared/ipc';

const projectsChangedSchema = z.strictObject({
	type: z.literal('projects-changed'),
	projectId: z.uuid(),
	sequence: z.number().int().positive(),
});

export type ProjectsChangedEvent = z.infer<typeof projectsChangedSchema>;

const projectRequestedSchema = z.strictObject({
	type: z.literal('project-requested'),
	projectId: z.uuid(),
	sequence: z.number().int().positive(),
});

const projectActivitySchema = z.strictObject({
	type: z.literal('project-activity'),
	projectId: z.uuid(),
	sequence: z.number().int().positive(),
	status: z.enum(['idle', 'running', 'needs-approval', 'finished', 'failed']),
});

const existingEventTypes = {
	'project-controls': true,
	project: true,
	'project-removed': true,
	'thread-removed': true,
	supervisor: true,
	capabilities: true,
	thread: true,
	turn: true,
} satisfies Record<
	Exclude<
		ProjectEvent['type'],
		'projects-changed' | 'project-activity' | 'project-requested'
	>,
	true
>;

export function projectEventForListener(value: unknown): ProjectEvent | null {
	if (!value || typeof value !== 'object' || !('type' in value)) return null;
	if (value.type === 'projects-changed') {
		const parsed = projectsChangedSchema.safeParse(value);
		return parsed.success ? parsed.data : null;
	}
	if (value.type === 'project-requested') {
		const parsed = projectRequestedSchema.safeParse(value);
		return parsed.success ? parsed.data : null;
	}
	if (value.type === 'project-activity') {
		const parsed = projectActivitySchema.safeParse(value);
		return parsed.success ? parsed.data : null;
	}
	if (
		typeof value.type !== 'string' ||
		!Object.hasOwn(existingEventTypes, value.type)
	)
		return null;
	return value as ProjectEvent;
}
