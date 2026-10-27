import type {Readable, Writable} from 'node:stream';
import type {AnyMessage, Stream} from '@agentclientprotocol/sdk';

const MAX_FRAME_LENGTH = 32 * 1024 * 1024;

// Carries no content: the SDK logs connection errors.
export class ProtocolViolation extends Error {
	constructor() {
		super('Nanocoder wrote something other than ACP to standard output');
	}
}

export function isFrame(value: unknown): value is AnyMessage {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const message = value as Record<string, unknown>;
	return (
		message.jsonrpc === '2.0' &&
		(typeof message.method === 'string' || 'id' in message)
	);
}

export async function* readFrames(
	chunks: AsyncIterable<Uint8Array | string>,
	onViolation: (line: string) => void,
	maxFrameLength = MAX_FRAME_LENGTH,
): AsyncGenerator<AnyMessage> {
	const decoder = new TextDecoder();
	let pending = '';
	const parse = (line: string): AnyMessage => {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			value = undefined;
		}
		if (!isFrame(value)) {
			onViolation(line);
			throw new ProtocolViolation();
		}
		return value;
	};

	for await (const chunk of chunks) {
		pending +=
			typeof chunk === 'string' ? chunk : decoder.decode(chunk, {stream: true});
		const lines = pending.split('\n');
		pending = lines.pop() ?? '';
		for (const line of lines) {
			if (line.trim() !== '') yield parse(line);
		}
		if (pending.length > maxFrameLength) {
			onViolation(pending.slice(0, 1024));
			throw new ProtocolViolation();
		}
	}
	pending += decoder.decode();
	if (pending.trim() !== '') yield parse(pending);
}

export function protocolStream(
	stdout: Readable,
	stdin: Writable,
	onViolation: (line: string) => void,
): Stream {
	const frames = readFrames(stdout, onViolation);
	return {
		readable: new ReadableStream<AnyMessage>({
			async pull(controller) {
				try {
					const next = await frames.next();
					if (next.done) {
						controller.close();
					} else {
						controller.enqueue(next.value);
					}
				} catch (error) {
					controller.error(error);
				}
			},
			cancel() {
				stdout.destroy();
			},
		}),
		writable: new WritableStream<AnyMessage>({
			write: message =>
				new Promise((resolve, reject) => {
					stdin.write(`${JSON.stringify(message)}\n`, error =>
						error ? reject(error) : resolve(),
					);
				}),
			close: () => {
				stdin.end();
			},
		}),
	};
}
