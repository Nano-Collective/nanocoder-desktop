import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import type {InitializeResponse} from '@agentclientprotocol/sdk';
import {capabilityGates, describeAgent} from '@/main/nanocoder/capabilities';
import {versionPolicy} from '@/main/nanocoder/version-policy';
import type {FeatureId} from '@/shared/ipc';

const recordsDirectory = path.resolve(
	'source',
	'main',
	'nanocoder',
	'conformance',
);

export interface ConformanceRecord {
	version: string;
	initialize: InitializeResponse;
	gates: {
		versionPolicy: ReturnType<typeof versionPolicy>;
		features: Record<FeatureId, boolean>;
		assumed: FeatureId[];
	};
}

export const recordPath = (version: string) =>
	path.join(recordsDirectory, `nanocoder-${version}.json`);

// The gates a recorded initialize answer produces. The extension probes and the browser server are not part of the answer, so the gates that depend on them are assumed healthy and listed as such. The version status leaves out the bundled exemption, so a record does not change when the bundle moves.
export function gatesFor(initialize: InitializeResponse) {
	const agent = describeAgent('/record', initialize);
	const gates = capabilityGates(
		'record',
		agent,
		{rename: true, timeline: true, pin: true, read: true},
		true,
	);
	return {
		versionPolicy: gates.versionPolicy,
		features: Object.fromEntries(
			Object.entries(gates.features).map(([id, gate]) => [id, gate.enabled]),
		) as Record<FeatureId, boolean>,
		assumed: [
			'rename',
			'timeline',
			'pinSession',
			'agentChanges',
			'browserControl',
		] as FeatureId[],
	};
}

export function readRecord(version: string): ConformanceRecord | undefined {
	try {
		return JSON.parse(readFileSync(recordPath(version), 'utf8'));
	} catch {
		return undefined;
	}
}

export function recordedVersions(): string[] {
	return readdirSync(recordsDirectory)
		.map(name => /^nanocoder-(.+)\.json$/.exec(name)?.[1])
		.filter((version): version is string => version !== undefined);
}
