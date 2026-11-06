import {z} from 'zod';
import type {BrowserService} from '@/main/browser/browser-service';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {registerHandler as registerIpcHandler} from '@/main/ipc/register';
import {
	BROWSER_BOUNDS_LIMIT,
	BROWSER_CHANNELS,
	type BrowserRequests,
	type BrowserResults,
} from '@/shared/browser';

const methods = {
	get: 'get',
	open: 'open',
	navigate: 'navigate',
	setBounds: 'setBounds',
	close: 'closeView',
	profiles: 'profiles',
	setProfile: 'setProfile',
	createProfile: 'createProfile',
	deleteProfile: 'deleteProfile',
	clearData: 'clearData',
	openExternal: 'openExternal',
} as const satisfies Record<keyof BrowserRequests, keyof BrowserService>;

export function registerBrowserHandlers(
	registerHandler: typeof registerIpcHandler,
	allowedOrigins: readonly string[],
	service?: BrowserService,
): void {
	const project = {projectId: z.uuid()};
	const edge = z.number().int().min(0).max(BROWSER_BOUNDS_LIMIT);
	const schemas: {
		[K in keyof BrowserRequests]: z.ZodType<BrowserRequests[K]>;
	} = {
		get: z.strictObject(project),
		open: z.strictObject({...project, url: z.string().min(1).max(2_048)}),
		navigate: z.strictObject({
			...project,
			action: z.enum(['back', 'forward', 'reload', 'stop']),
		}),
		setBounds: z.strictObject({
			...project,
			bounds: z
				.strictObject({x: edge, y: edge, width: edge, height: edge})
				.nullable(),
		}),
		close: z.strictObject(project),
		profiles: z.strictObject(project),
		setProfile: z.strictObject({
			...project,
			profile: z.string().min(1).max(40),
		}),
		createProfile: z.strictObject({
			...project,
			name: z.string().min(1).max(40),
		}),
		deleteProfile: z.strictObject({...project, id: z.uuid()}),
		clearData: z.strictObject({...project, profile: z.string().min(1).max(40)}),
		openExternal: z.strictObject(project),
	};
	const register = <K extends keyof BrowserRequests>(key: K) => {
		registerHandler(
			BROWSER_CHANNELS[key],
			schemas[key],
			async (request): Promise<BrowserResults[K]> => {
				if (!service)
					throw new IpcFailure('UNAVAILABLE', 'The browser is unavailable');
				try {
					// Each schema and method share the same keyed contract.
					const method = service[methods[key]] as (
						input: BrowserRequests[K],
					) => BrowserResults[K] | Promise<BrowserResults[K]>;
					return await method.call(service, request);
				} catch (error) {
					if (error instanceof IpcFailure) throw error;
					throw new IpcFailure(
						'UNAVAILABLE',
						'The browser request could not finish',
					);
				}
			},
			allowedOrigins,
		);
	};
	for (const key of Object.keys(schemas) as Array<keyof BrowserRequests>)
		register(key);
}
