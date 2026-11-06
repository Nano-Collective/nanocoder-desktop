import {randomUUID} from 'node:crypto';
import {
	type BrowserProfileRef,
	parseProfileKey,
	profileKey,
} from '@/main/browser/profile';
import {IpcFailure} from '@/main/ipc/handle-request';

const NAME_LIMIT = 40;
const PROFILE_LIMIT = 20;

export interface NamedProfile {
	id: string;
	name: string;
}

export interface ProfileData {
	profiles: NamedProfile[];
	assignments: Record<string, string>;
}

export class BrowserProfiles {
	constructor(
		private readonly storage: {
			get(): ProfileData;
			set(data: ProfileData): void;
		},
	) {}

	list(): NamedProfile[] {
		return this.storage.get().profiles;
	}

	resolve(projectId: string): BrowserProfileRef {
		const data = this.storage.get();
		const assigned = parseProfileKey(data.assignments[projectId] ?? 'project');
		if (!assigned) return {kind: 'project'};
		if (
			assigned.kind === 'named' &&
			!data.profiles.some(profile => profile.id === assigned.id)
		)
			return {kind: 'project'};
		return assigned;
	}

	create(rawName: string): NamedProfile {
		const name = rawName.trim();
		if (
			name === '' ||
			name.length > NAME_LIMIT ||
			/[\u0000-\u001f\u007f]/.test(name)
		)
			throw new IpcFailure(
				'VALIDATION',
				`Use a name of 1 to ${NAME_LIMIT} characters`,
			);
		const data = this.storage.get();
		if (data.profiles.length >= PROFILE_LIMIT)
			throw new IpcFailure(
				'LIMIT',
				`You can keep at most ${PROFILE_LIMIT} browser profiles`,
			);
		if (
			data.profiles.some(
				profile => profile.name.toLowerCase() === name.toLowerCase(),
			)
		)
			throw new IpcFailure('VALIDATION', 'A profile with that name exists');
		const profile = {id: randomUUID(), name};
		this.storage.set({...data, profiles: [...data.profiles, profile]});
		return profile;
	}

	assign(projectId: string, profile: BrowserProfileRef): void {
		const data = this.storage.get();
		if (
			profile.kind === 'named' &&
			!data.profiles.some(candidate => candidate.id === profile.id)
		)
			throw new IpcFailure('NOT_FOUND', 'That browser profile does not exist');
		const assignments = {...data.assignments};
		if (profile.kind === 'project') delete assignments[projectId];
		else assignments[projectId] = profileKey(profile);
		this.storage.set({...data, assignments});
	}

	delete(rawId: string): string[] {
		const id = rawId.toLowerCase();
		const data = this.storage.get();
		if (!data.profiles.some(profile => profile.id === id))
			throw new IpcFailure('NOT_FOUND', 'That browser profile does not exist');
		const affected = Object.entries(data.assignments)
			.filter(([, value]) => value === id)
			.map(([projectId]) => projectId);
		this.storage.set({
			profiles: data.profiles.filter(profile => profile.id !== id),
			assignments: Object.fromEntries(
				Object.entries(data.assignments).filter(([, value]) => value !== id),
			),
		});
		return affected;
	}
}
