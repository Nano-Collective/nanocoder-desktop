import {z} from 'zod';

export interface SessionTitleChange {
	sessionId: string;
	title: string;
}

export function sessionTitle(value: unknown): SessionTitleChange | undefined {
	const parsed = z
		.object({
			sessionId: z.string().trim().min(1).max(200),
			title: z.string().trim().min(1).max(500),
		})
		.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}
