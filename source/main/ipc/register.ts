import {type IpcMainInvokeEvent, ipcMain} from 'electron';
import type {z} from 'zod';
import {handleRequest, type Sender} from '@/main/ipc/handle-request';

function senderOf(event: IpcMainInvokeEvent): Sender {
	const frame = event.senderFrame;
	return {
		url: frame?.url,
		isMainFrame: frame !== null && frame === event.sender.mainFrame,
	};
}

export function registerHandler<Request, Value>(
	channel: string,
	schema: z.ZodType<Request>,
	handler: (request: Request) => Value | Promise<Value>,
	allowedOrigins: readonly string[],
): void {
	ipcMain.handle(channel, (event, payload: unknown) =>
		handleRequest({
			sender: senderOf(event),
			payload,
			schema,
			handler,
			allowedOrigins,
		}),
	);
}
