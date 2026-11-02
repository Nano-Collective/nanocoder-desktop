import type {NanocoderMode, ProjectConfigSelect} from '@/shared/ipc';

function own(value: unknown, key: string): unknown {
	return value !== null && typeof value === 'object'
		? Object.getOwnPropertyDescriptor(value, key)?.value
		: undefined;
}

function text(value: unknown, limit: number): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= limit &&
		!/[\u0000-\u001f\u007f]/u.test(value)
	);
}

export function sessionModeOptions(value: unknown): NanocoderMode[] {
	try {
		if (!Array.isArray(value) || value.length > 32) return [];
		const modes: NanocoderMode[] = [];
		for (let i = 0; i < value.length; i++) {
			const id = own(own(value, String(i)), 'id');
			if (typeof id !== 'string' || modes.includes(id as NanocoderMode))
				return [];
			if (
				id === 'normal' ||
				id === 'auto-accept' ||
				id === 'yolo' ||
				id === 'plan' ||
				id === 'architect'
			)
				modes.push(id);
		}
		return modes;
	} catch {
		return [];
	}
}

export function projectConfigOptions(
	value: unknown,
): ProjectConfigSelect[] | undefined {
	try {
		if (!Array.isArray(value) || value.length > 32) return undefined;
		const projected: ProjectConfigSelect[] = [];
		const ids = new Set<string>();
		for (let i = 0; i < value.length; i++) {
			const raw = own(value, String(i));
			const id = own(raw, 'id');
			if (typeof id !== 'string') return undefined;
			if (id !== 'provider' && id !== 'model') continue;
			const name = own(raw, 'name');
			const currentValue = own(raw, 'currentValue');
			const options = own(raw, 'options');
			if (
				ids.has(id) ||
				own(raw, 'type') !== 'select' ||
				own(raw, 'category') !== 'model' ||
				!text(name, 256) ||
				!text(currentValue, 512) ||
				!Array.isArray(options) ||
				options.length > (id === 'provider' ? 64 : 256)
			)
				return undefined;
			const values = new Set<string>();
			const offered: ProjectConfigSelect['options'] = [];
			for (let j = 0; j < options.length; j++) {
				const option = own(options, String(j));
				const name = own(option, 'name');
				const value = own(option, 'value');
				if (!text(name, 256) || !text(value, 512) || values.has(value))
					return undefined;
				values.add(value);
				offered.push({name, value});
			}
			if (!values.has(currentValue)) return undefined;
			ids.add(id);
			projected.push({id, name, currentValue, options: offered});
		}
		return Buffer.byteLength(JSON.stringify(projected), 'utf8') <= 256 * 1024
			? projected
			: undefined;
	} catch {
		return undefined;
	}
}
