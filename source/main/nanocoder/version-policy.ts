import type {VersionPolicyResult} from '@/shared/ipc';

// Provisional next minor after 1.31.0, which predates the trust check (OQ-02).
export const MIN_NANOCODER_VERSION = '1.32.0';
const LAST_TESTED_VERSION = '1.31.0';

function release(value: string): number[] | undefined {
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
			value,
		);
	if (!match) return undefined;
	const parts = match.slice(1, 4).map(Number);
	return parts.every(Number.isSafeInteger) ? parts : undefined;
}

function compare(left: number[], right: number[]): number {
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return 0;
}

export function versionPolicy(
	version: string | null,
	bundledVersion?: string,
): VersionPolicyResult {
	if (version !== null && version === bundledVersion) {
		return {status: 'bundled', version, reason: null};
	}
	const parsed = version === null ? undefined : release(version);
	if (!parsed || version === null) {
		return {
			status: 'refused',
			version,
			reason: `Nanocoder must report a stable version at or above ${MIN_NANOCODER_VERSION}; found ${version ?? 'no version'}. Pre-release and unrecognised versions are not supported.`,
		};
	}
	if (compare(parsed, MIN_NANOCODER_VERSION.split('.').map(Number)) < 0) {
		return {
			status: 'refused',
			version,
			reason: `Nanocoder ${version} is below the minimum ${MIN_NANOCODER_VERSION}. Upgrade Nanocoder: published 1.31.0 lacks the required ACP directory trust check.`,
		};
	}
	if (compare(parsed, LAST_TESTED_VERSION.split('.').map(Number)) > 0) {
		return {
			status: 'untested',
			version,
			reason: `Nanocoder ${version} is newer than the tested ${LAST_TESTED_VERSION} development build (8a5f4d4). Compatibility is unverified; missing features stay disabled.`,
		};
	}
	return {status: 'supported', version, reason: null};
}
