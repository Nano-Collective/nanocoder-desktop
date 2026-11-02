import * as React from 'react';
import {Button} from '@/renderer/ui';
import type {
	CapabilityGate,
	CapabilityGates,
	ConnectedAgent,
	FeatureId,
	ThreadInfo,
} from '@/shared/ipc';

export interface CapabilitiesDialogProps {
	gates: CapabilityGates | null;
	modelGate: CapabilityGate | null;
	agent: ConnectedAgent | null;
	thread: ThreadInfo | null;
}

export interface CapabilityRow {
	label: string;
	gate: CapabilityGate;
}

// Only gates that exist in CapabilityGates; browser control is milestone 3.
export function capabilityRows(
	gates: CapabilityGates,
	modelGate: CapabilityGate | null,
): CapabilityRow[] {
	const feature = (id: FeatureId, label: string): CapabilityRow => ({
		label,
		gate: gates.features[id],
	});
	return [
		feature('resume', 'session resume'),
		{
			label: 'model + mode offers',
			gate: modelGate ?? {
				enabled: false,
				reason: 'not reported for this project yet',
			},
		},
		feature('agentChanges', 'exact agent changes'),
		feature('subagentTree', 'child run tree'),
		feature('close', 'session close'),
		feature('delete', 'session delete'),
		feature('list', 'session list'),
		feature('rename', 'session rename'),
		feature('timeline', 'tool timeline'),
	];
}

export function CapabilitiesDialogBody({
	gates,
	modelGate,
	agent,
	thread,
}: CapabilitiesDialogProps): React.ReactElement {
	return (
		<>
			{agent && (
				<section aria-label="connected agent" className="capability-agent">
					<p>
						connected to {agent.name ?? 'an unnamed agent'}{' '}
						{agent.version ?? '(no version)'} over ACP protocol version{' '}
						{agent.protocolVersion}
					</p>
					{thread?.nanocoderSessionId && (
						<p>
							session {thread.nanocoderSessionId} in {thread.mode} mode
						</p>
					)}
				</section>
			)}
			{gates ? (
				<section aria-label="Nanocoder capabilities">
					<ul className="capability-rows">
						{capabilityRows(gates, modelGate).map(row => (
							<li key={row.label} className="capability-row">
								<span aria-hidden="true">{row.gate.enabled ? '✓' : '○'}</span>{' '}
								<span className="capability-label">{row.label}</span>{' '}
								<span className="capability-reason">
									{row.gate.enabled ? 'available' : row.gate.reason}
								</span>
							</li>
						))}
					</ul>
				</section>
			) : (
				<p role="status">
					Nanocoder has not reported capabilities for this project yet.
				</p>
			)}
		</>
	);
}

export function CapabilitiesDialogFooter({
	onClose,
}: {
	onClose(): void;
}): React.ReactElement {
	return <Button onClick={onClose}>close</Button>;
}
