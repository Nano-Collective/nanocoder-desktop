import type {z} from 'zod';
import {isAllowedOrigin} from '@/main/security';
import type {IpcError, IpcResult} from '@/shared/ipc';

export class IpcFailure extends Error {
	constructor(
		readonly code: IpcError['code'],
		message: string,
		readonly retryable = false,
	) {
		super(message);
	}
}

export interface Sender {
	url: string | undefined;
	isMainFrame: boolean;
}

function failure<T>(
	code: IpcError['code'],
	message: string,
	retryable = false,
): IpcResult<T> {
	return {ok: false, error: {code, message, retryable}};
}

export function isTrustedSender(
	sender: Sender,
	allowedOrigins: readonly string[],
): boolean {
	return (
		sender.isMainFrame &&
		sender.url !== undefined &&
		isAllowedOrigin(sender.url, allowedOrigins)
	);
}

export async function handleRequest<Request, Value>(options: {
	sender: Sender;
	payload: unknown;
	schema: z.ZodType<Request>;
	handler: (request: Request) => Value | Promise<Value>;
	allowedOrigins: readonly string[];
}): Promise<IpcResult<Value>> {
	if (!isTrustedSender(options.sender, options.allowedOrigins)) {
		return failure('DENIED', 'Request from an untrusted sender');
	}

	const parsed = options.schema.safeParse(options.payload);
	if (!parsed.success) {
		return failure('VALIDATION', 'Invalid request');
	}

	try {
		return {ok: true, value: await options.handler(parsed.data)};
	} catch (error) {
		if (error instanceof IpcFailure) {
			return failure(error.code, error.message, error.retryable);
		}
		console.error(error);
		return failure('INTERNAL', 'Something went wrong');
	}
}
