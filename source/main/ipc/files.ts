import {z} from 'zod';
import type {FilesRuntime} from '@/main/files/runtime';
import {IpcFailure} from '@/main/ipc/handle-request';
import type {registerHandler as registerIpcHandler} from '@/main/ipc/register';
import {
	FILES_CHANNELS,
	type FilesRequests,
	type FilesValues,
} from '@/shared/files';
import {
	REVIEW_CHANNELS,
	type ReviewRequests,
	type ReviewValues,
} from '@/shared/review';

const project = {projectId: z.uuid()};
const path = z.string().max(4_096);

const filesSchemas: {[K in keyof FilesRequests]: z.ZodType<FilesRequests[K]>} =
	{
		list: z.strictObject({...project, path}),
		preview: z.strictObject({...project, path}),
		openInEditor: z.strictObject({
			...project,
			path,
			line: z.number().int().min(1).max(10_000_000).optional(),
		}),
		reveal: z.strictObject({...project, path}),
	};

const reviewSchemas: {
	[K in keyof ReviewRequests]: z.ZodType<ReviewRequests[K]>;
} = {
	status: z.strictObject(project),
	diff: z.strictObject({...project, path: path.min(1), staged: z.boolean()}),
};

export function registerFilesHandlers(
	registerHandler: typeof registerIpcHandler,
	allowedOrigins: readonly string[],
	runtime?: FilesRuntime,
): void {
	const available = (): FilesRuntime => {
		if (!runtime)
			throw new IpcFailure('UNAVAILABLE', 'The file browser is unavailable');
		return runtime;
	};
	const files: {
		[K in keyof FilesRequests]: (
			request: FilesRequests[K],
		) => FilesValues[K] | Promise<FilesValues[K]>;
	} = {
		list: request => available().files.list(request),
		preview: request => available().files.preview(request),
		openInEditor: async request => {
			const {files: service, editor} = available();
			// The path is resolved and contained before anything is launched.
			const {resolved} = await service.locate(request.projectId, request.path);
			return editor.open(resolved.real, request.line);
		},
		reveal: async request => {
			const {files: service, editor} = available();
			const {resolved} = await service.locate(request.projectId, request.path);
			editor.reveal(resolved.real);
			return null;
		},
	};
	const review: {
		[K in keyof ReviewRequests]: (
			request: ReviewRequests[K],
		) => ReviewValues[K] | Promise<ReviewValues[K]>;
	} = {
		status: request => available().review.status(request),
		diff: request => available().review.diff(request),
	};
	const registerFile = <K extends keyof FilesRequests>(key: K) =>
		registerHandler(
			FILES_CHANNELS[key],
			filesSchemas[key],
			files[key],
			allowedOrigins,
		);
	const registerReview = <K extends keyof ReviewRequests>(key: K) =>
		registerHandler(
			REVIEW_CHANNELS[key],
			reviewSchemas[key],
			review[key],
			allowedOrigins,
		);
	for (const key of Object.keys(files) as Array<keyof FilesRequests>)
		registerFile(key);
	for (const key of Object.keys(review) as Array<keyof ReviewRequests>)
		registerReview(key);
}
