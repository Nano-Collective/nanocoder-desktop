import path from 'node:path';
import {z} from 'zod';
import {sessionTitle} from '@/main/nanocoder/session-title';
import {canonicalPath} from '@/main/paths';
import {nanocoderSessionIdSchema} from '@/main/store/validation';
import type {DiscoveredSession} from '@/shared/ipc';

const cwdSchema = z
	.string()
	.min(1)
	.max(32_768)
	.refine(value => path.isAbsolute(value) && !value.includes('\0'));
const timestampSchema = z.iso.datetime();
const MAX_SESSIONS = 512;
const MAX_METADATA_BYTES = 512 * 1024;
const record = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

export interface DiscoveredSessionProof {
	session: DiscoveredSession;
	reportedCwd: string;
}

export async function sessionDiscovery(
	response: unknown,
	canonicalRoot: string,
): Promise<DiscoveredSessionProof[]> {
	const entries = record(response)?.sessions;
	if (!Array.isArray(entries) || entries.length > MAX_SESSIONS) return [];
	try {
		if ((await canonicalPath(canonicalRoot)) !== canonicalRoot) return [];
	} catch {
		return [];
	}
	const unique = new Map<string, Record<string, unknown>>();
	const ambiguous = new Set<string>();
	for (const entry of entries) {
		const raw = record(entry);
		const id = nanocoderSessionIdSchema.safeParse(raw?.sessionId);
		if (!raw || !id.success) continue;
		if (unique.has(id.data)) ambiguous.add(id.data);
		unique.set(id.data, raw);
	}
	const result: DiscoveredSessionProof[] = [];
	let metadataBytes = 0;
	for (const [id, raw] of unique) {
		if (ambiguous.has(id)) continue;
		const cwd = cwdSchema.safeParse(raw.cwd);
		if (!cwd.success) continue;
		metadataBytes += Buffer.byteLength(id) + Buffer.byteLength(cwd.data);
		if (metadataBytes > MAX_METADATA_BYTES) return [];
		try {
			if ((await canonicalPath(cwd.data)) !== canonicalRoot) continue;
		} catch {
			continue;
		}
		const title =
			raw.title === undefined
				? 'untitled session'
				: sessionTitle({sessionId: id, title: raw.title})?.title;
		const timestamp =
			raw.updatedAt == null ? null : timestampSchema.safeParse(raw.updatedAt);
		if (!title || (timestamp !== null && !timestamp.success)) continue;
		metadataBytes +=
			Buffer.byteLength(title) +
			(timestamp ? Buffer.byteLength(timestamp.data) : 0);
		if (metadataBytes > MAX_METADATA_BYTES) return [];
		result.push({
			session: {
				id,
				title,
				sessionCwd: canonicalRoot,
				lastActivityAt: timestamp
					? new Date(timestamp.data).toISOString()
					: null,
			},
			reportedCwd: cwd.data,
		});
	}
	return result.sort(
		(a, b) =>
			(b.session.lastActivityAt ?? '').localeCompare(
				a.session.lastActivityAt ?? '',
			) || a.session.id.localeCompare(b.session.id),
	);
}
