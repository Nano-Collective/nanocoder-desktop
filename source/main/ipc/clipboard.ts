import {z} from 'zod';
import {IpcFailure} from '@/main/ipc/handle-request';

export const clipboardWriteSchema = z.strictObject({
	text: z.string().max(1_000_000),
});

export async function writeClipboard(
	request: z.infer<typeof clipboardWriteSchema>,
	write: (text: string) => void | Promise<void>,
): Promise<null> {
	try {
		await write(request.text);
		return null;
	} catch {
		throw new IpcFailure('UNAVAILABLE', 'Clipboard write failed', true);
	}
}
