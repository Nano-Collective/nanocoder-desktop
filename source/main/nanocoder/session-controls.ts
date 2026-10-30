import {
	projectConfigOptions,
	sessionModeOptions,
} from '@/main/nanocoder/control-options';
import type {
	NanocoderMode,
	ProjectConfigSelect,
	SessionInfo,
} from '@/shared/ipc';

export interface SessionOffers {
	offeredModes: NanocoderMode[];
	configOptions: ProjectConfigSelect[] | undefined;
}

interface SessionControlOptions {
	isReady(sessionId: string): boolean;
	isPrompting(): boolean;
	setReady(sessionId: string, ready: boolean): void;
	setMode(sessionId: string, mode: NanocoderMode): Promise<unknown>;
	setConfigOption(
		sessionId: string,
		configId: ProjectConfigSelect['id'],
		value: string,
	): Promise<unknown>;
	failure(code: 'UNSUPPORTED' | 'AGENT_UNAVAILABLE', message: string): Error;
}

export function createSessionControls(options: SessionControlOptions) {
	const modes = new Map<string, NanocoderMode[]>();
	let configOptions: ProjectConfigSelect[] | undefined;
	let uncertain = false;
	const getSessionOffers = (sessionId: string): SessionOffers | undefined => {
		const offeredModes = modes.get(sessionId);
		return offeredModes && options.isReady(sessionId)
			? structuredClone({
					offeredModes,
					configOptions: uncertain ? undefined : configOptions,
				})
			: undefined;
	};
	const mutableOffers = (sessionId: string) => {
		const offers = getSessionOffers(sessionId);
		if (!offers || options.isPrompting())
			throw options.failure(
				'AGENT_UNAVAILABLE',
				'The session cannot change controls now',
			);
		return offers;
	};
	return {
		remember(sessionId: string, availableModes: unknown, config: unknown) {
			modes.set(sessionId, sessionModeOptions(availableModes));
			configOptions = projectConfigOptions(config);
		},
		forget(sessionId: string) {
			modes.delete(sessionId);
			options.setReady(sessionId, false);
		},
		getSessionOffers,
		canPrompt: () => !uncertain,
		setMode: async (
			sessionId: string,
			mode: NanocoderMode,
		): Promise<SessionInfo> => {
			if (!mutableOffers(sessionId).offeredModes.includes(mode))
				throw options.failure(
					'UNSUPPORTED',
					'Nanocoder did not offer this mode',
				);
			options.setReady(sessionId, false);
			try {
				await options.setMode(sessionId, mode);
				options.setReady(sessionId, true);
				return {id: sessionId, mode};
			} catch {
				throw options.failure(
					'AGENT_UNAVAILABLE',
					`Nanocoder did not set the ${mode} mode`,
				);
			}
		},
		setConfigOption: async (
			sessionId: string,
			id: ProjectConfigSelect['id'],
			value: string,
		): Promise<SessionOffers> => {
			const option = mutableOffers(sessionId).configOptions?.find(
				option => option.id === id,
			);
			if (!option?.options.some(option => option.value === value))
				throw options.failure(
					'UNSUPPORTED',
					'Nanocoder did not offer this model option',
				);
			uncertain = true;
			try {
				const confirmed = projectConfigOptions(
					await options.setConfigOption(sessionId, id, value),
				);
				if (!confirmed) throw new Error('invalid config');
				configOptions = confirmed;
				uncertain = false;
				const offers = getSessionOffers(sessionId);
				if (!offers) throw new Error('session unavailable');
				return offers;
			} catch {
				uncertain = true;
				configOptions = undefined;
				throw options.failure(
					'AGENT_UNAVAILABLE',
					'Nanocoder did not confirm the model change; restart Nanocoder before sending',
				);
			}
		},
	};
}
