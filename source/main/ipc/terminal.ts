import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {registerHandler as registerIpcHandler} from '@/main/ipc/register';
import type {TerminalService} from '@/main/terminal/terminal-service';
import {
	TERMINAL_CHANNELS,
	type TerminalRequests,
	type TerminalSnapshot,
} from '@/shared/terminal';

export function registerTerminalHandlers(
	registerHandler: typeof registerIpcHandler,
	allowedOrigins: readonly string[],
	service?: TerminalService,
): void {
	const project = {projectId: z.uuid()};
	const schemas: {
		[K in keyof TerminalRequests]: z.ZodType<TerminalRequests[K]>;
	} = {
		get: z.strictObject(project),
		start: z.strictObject(project),
		stop: z.strictObject(project),
		restart: z.strictObject(project),
		clear: z.strictObject(project),
		write: z.strictObject({
			...project,
			data: z
				.string()
				.min(1)
				.max(65_536)
				.refine(
					value =>
						!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
							value,
						),
				),
		}),
		resize: z.strictObject({
			...project,
			cols: z.number().int().min(2).max(500),
			rows: z.number().int().min(2).max(500),
		}),
	};
	const register = <K extends keyof TerminalRequests>(key: K) => {
		registerHandler(
			TERMINAL_CHANNELS[key],
			schemas[key],
			async (request): Promise<TerminalSnapshot> => {
				if (!service)
					throw new IpcFailure('UNAVAILABLE', 'The terminal is unavailable');
				try {
					// Each schema and method share the same keyed contract.
					const method = service[key] as (
						input: TerminalRequests[K],
					) => TerminalSnapshot | Promise<TerminalSnapshot>;
					return await method.call(service, request);
				} catch (error) {
					if (error instanceof IpcFailure) throw error;
					throw new IpcFailure(
						'UNAVAILABLE',
						'The terminal request could not finish',
					);
				}
			},
			allowedOrigins,
		);
	};
	for (const key of Object.keys(schemas) as Array<keyof TerminalRequests>)
		register(key);
}
