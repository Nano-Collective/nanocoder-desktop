import {stat} from 'node:fs/promises';
import path from 'node:path';
import {RequestError} from '@agentclientprotocol/sdk';
import {decodeText} from '@/main/files/encoding';
import {FILE_LIMITS} from '@/main/files/limits';
import {
	openVerified,
	relativeFromAbsolute,
	resolveInside,
} from '@/main/files/safe-path';
import {IpcFailure} from '@/main/ipc/handle-request';
import {canonicalPath} from '@/main/paths';

// JSON-RPC and ACP codes. Nanocoder shows these messages to the model, so they
// say what was refused without naming anything outside the project.
const INVALID_PARAMS = -32602;
const NOT_FOUND = -32002;
const LIMITED = -32000;

const SCAN_CAP = 16 * 1_048_576;
const CHUNK = 65_536;

export interface AgentReadParams {
	path: string;
	line?: number | null;
	limit?: number | null;
}

function refuse(error: unknown): never {
	if (error instanceof RequestError) throw error;
	if (error instanceof IpcFailure) {
		const code =
			error.code === 'NOT_FOUND'
				? NOT_FOUND
				: error.code === 'LIMIT'
					? LIMITED
					: INVALID_PARAMS;
		throw new RequestError(code, error.message);
	}
	throw new RequestError(NOT_FOUND, 'That file could not be read');
}

// ACP-11, SEC-20: root-checked, bounded, read-only text reads. The same path
// resolution as the file browser, so a link or junction out of the root is
// refused here too.
export async function readTextForAgent(
	root: string,
	params: AgentReadParams,
): Promise<{content: string}> {
	try {
		return await read(root, params);
	} catch (error) {
		return refuse(error);
	}
}

async function read(
	root: string,
	params: AgentReadParams,
): Promise<{content: string}> {
	const line = params.line ?? 1;
	const limit = params.limit ?? undefined;
	if (!Number.isSafeInteger(line) || line < 1)
		throw new RequestError(INVALID_PARAMS, 'The line must be 1 or more');
	if (
		limit !== undefined &&
		(!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000)
	)
		throw new RequestError(INVALID_PARAMS, 'The line limit is not valid');
	// The folder may have been swapped for a link since the project was opened.
	if ((await canonicalPath(root)) !== root)
		throw new RequestError(INVALID_PARAMS, 'The project folder changed');
	const relative = relativeFromAbsolute(root, params.path);
	if (relative.split('/').some(part => part.toLowerCase() === '.git'))
		throw new RequestError(INVALID_PARAMS, 'The .git folder is not readable');
	const resolved = await resolveInside(root, relative);
	if (
		path
			.relative(root, resolved.real)
			.split(path.sep)
			.some(part => part.toLowerCase() === '.git')
	)
		throw new RequestError(INVALID_PARAMS, 'The .git folder is not readable');
	const info = await stat(resolved.real);
	if (!info.isFile())
		throw new RequestError(INVALID_PARAMS, 'That path is not a file');
	const handle = await openVerified(resolved.real);
	try {
		const ranged = params.line != null || limit !== undefined;
		if (info.size <= FILE_LIMITS.acpReadBytes) {
			const buffer = Buffer.alloc(info.size);
			const {bytesRead} = await handle.read(buffer, 0, info.size, 0);
			const decoded = decodeText(buffer.subarray(0, bytesRead));
			if (decoded.kind !== 'text')
				throw new RequestError(
					INVALID_PARAMS,
					'That file is not readable text',
				);
			return {
				content: ranged ? lines(decoded.text, line, limit) : decoded.text,
			};
		}
		if (!ranged)
			throw new RequestError(
				LIMITED,
				'That file is larger than 1 MiB; ask for a line range',
			);
		return {content: await largeRange(handle, info.size, line, limit)};
	} finally {
		await handle.close();
	}
}

function lines(text: string, from: number, limit: number | undefined): string {
	const all = text.split(/(?<=\n)/u);
	return all.slice(from - 1, limit ? from - 1 + limit : undefined).join('');
}

// A range inside a file over 1 MiB: scan for line starts in chunks, bounded.
async function largeRange(
	handle: Awaited<ReturnType<typeof openVerified>>,
	size: number,
	from: number,
	limit: number | undefined,
): Promise<string> {
	const sniff = Buffer.alloc(FILE_LIMITS.binarySniffBytes);
	const {bytesRead: sniffed} = await handle.read(sniff, 0, sniff.length, 0);
	if (sniff.subarray(0, sniffed).includes(0))
		throw new RequestError(INVALID_PARAMS, 'That file is not readable text');
	const end = limit ? from - 1 + limit : Number.POSITIVE_INFINITY;
	let lineNumber = 0;
	let start = from === 1 ? 0 : -1;
	let stop = size;
	const chunk = Buffer.alloc(CHUNK);
	for (let offset = 0; offset < size; offset += CHUNK) {
		if (offset > SCAN_CAP)
			throw new RequestError(
				LIMITED,
				'That line range is too far into the file',
			);
		const {bytesRead} = await handle.read(chunk, 0, CHUNK, offset);
		for (let index = 0; index < bytesRead; index++) {
			if (chunk[index] !== 0x0a) continue;
			lineNumber++;
			if (lineNumber === from - 1) start = offset + index + 1;
			if (lineNumber === end) {
				stop = offset + index + 1;
				offset = size;
				break;
			}
		}
	}
	if (start < 0) return '';
	if (stop - start > FILE_LIMITS.acpReadBytes)
		throw new RequestError(LIMITED, 'That line range is larger than 1 MiB');
	const body = Buffer.alloc(stop - start);
	await handle.read(body, 0, body.length, start);
	try {
		return new TextDecoder('utf-8', {fatal: true}).decode(body);
	} catch {
		throw new RequestError(INVALID_PARAMS, 'That file is not valid UTF-8');
	}
}
