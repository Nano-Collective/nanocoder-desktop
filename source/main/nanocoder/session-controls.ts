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

export interface ConfigOptionsObserver {
	isCurrentSession(sessionId: string): boolean;
	onChange(sessionId: string): void;
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

function own(value: unknown, key: string): unknown {
	try {
		return value !== null && typeof value === 'object'
			? Object.getOwnPropertyDescriptor(value, key)?.value
			: undefined;
	} catch {
		return undefined;
	}
}

export function createSessionControls(options: SessionControlOptions) {
	const modes = new Map<string, NanocoderMode[]>();
	const observers = new Set<ConfigOptionsObserver>();
	let observed = false;
	let disposed = false;
	let configOptions: ProjectConfigSelect[] | undefined;
	let uncertain = false;
	const getSessionOffers = (sessionId: string): SessionOffers | undefined => {
		const offeredModes = modes.get(sessionId);
		return !disposed && offeredModes && options.isReady(sessionId)
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
	const updateConfigOptions = (
		sessionId: string,
		raw: unknown,
		replaying = false,
	) => {
		if (
			disposed ||
			replaying ||
			uncertain ||
			!modes.has(sessionId) ||
			!options.isReady(sessionId)
		)
			return false;
		const owners = [...observers].filter(observer =>
			observer.isCurrentSession(sessionId),
		);
		if (observed && !owners.length) return false;
		const confirmed = projectConfigOptions(raw);
		if (
			!confirmed?.length ||
			JSON.stringify(confirmed) === JSON.stringify(configOptions)
		)
			return false;
		configOptions = confirmed;
		for (const owner of owners) owner.onChange(sessionId);
		return true;
	};
	return {
		remember(sessionId: string, availableModes: unknown, config: unknown) {
			if (disposed) return;
			modes.set(sessionId, sessionModeOptions(availableModes));
			configOptions = projectConfigOptions(config);
		},
		observeConfigOptions(observer: ConfigOptionsObserver) {
			observed = true;
			if (!disposed) observers.add(observer);
			return () => {
				observers.delete(observer);
			};
		},
		updateConfigOptions,
		receiveConfigNotification(frame: unknown, replaying = false) {
			const params = own(frame, 'params');
			const update = own(params, 'update');
			const sessionId = own(params, 'sessionId');
			if (
				own(frame, 'jsonrpc') !== '2.0' ||
				own(frame, 'method') !== 'session/update' ||
				own(frame, 'id') !== undefined ||
				typeof sessionId !== 'string' ||
				own(update, 'sessionUpdate') !== 'config_option_update'
			)
				return false;
			return updateConfigOptions(
				sessionId,
				own(update, 'configOptions'),
				replaying,
			);
		},
		dispose() {
			disposed = true;
			observers.clear();
			modes.clear();
			configOptions = undefined;
		},
		forget(sessionId: string) {
			modes.delete(sessionId);
			options.setReady(sessionId, false);
		},
		getSessionOffers,
		canPrompt: () => !disposed && !uncertain,
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
