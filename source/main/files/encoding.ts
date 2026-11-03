import {FILE_LIMITS} from '@/main/files/limits';
import type {TextEncoding} from '@/shared/files';

export type Decoded =
	| {kind: 'text'; text: string; encoding: TextEncoding}
	| {kind: 'binary'}
	| {kind: 'unsupported'; detail: string};

const strictUtf8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const strictUtf16 = new TextDecoder('utf-16le', {fatal: true, ignoreBOM: true});

// Detects and labels; never rewrites. A file that is not UTF-8 or UTF-16 with a
// byte order mark is reported, not guessed at, so nothing is shown corrupted.
export function decodeText(bytes: Buffer): Decoded {
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	) {
		try {
			return {
				kind: 'text',
				text: strictUtf8.decode(bytes.subarray(3)),
				encoding: 'utf-8-bom',
			};
		} catch {
			return {
				kind: 'unsupported',
				detail: 'It starts like UTF-8 but is not valid UTF-8.',
			};
		}
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
		return utf16(bytes.subarray(2), 'utf-16le');
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
		return utf16(bytes.subarray(2), 'utf-16be');
	// The rule Git uses: a NUL byte near the start means binary.
	if (bytes.subarray(0, FILE_LIMITS.binarySniffBytes).includes(0))
		return {kind: 'binary'};
	try {
		return {kind: 'text', text: strictUtf8.decode(bytes), encoding: 'utf-8'};
	} catch {
		return {
			kind: 'unsupported',
			detail:
				'It is not valid UTF-8 and may use another encoding such as Latin-1. It is shown unchanged on disk.',
		};
	}
}

function utf16(body: Buffer, encoding: 'utf-16le' | 'utf-16be'): Decoded {
	if (body.length % 2 !== 0)
		return {kind: 'unsupported', detail: 'It is not valid UTF-16.'};
	const little = encoding === 'utf-16le' ? body : Buffer.from(body).swap16();
	try {
		return {kind: 'text', text: strictUtf16.decode(little), encoding};
	} catch {
		return {kind: 'unsupported', detail: 'It is not valid UTF-16.'};
	}
}
