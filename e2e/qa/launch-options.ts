import {E2E_HIDDEN_SWITCH} from '@/main/window-presentation';

export function e2eArguments(
	args: readonly string[],
	visible = process.env.NANOCODER_E2E_VISIBLE,
): string[] {
	const normal = args.filter(arg => arg !== E2E_HIDDEN_SWITCH);
	return visible === '1' ? normal : [...normal, E2E_HIDDEN_SWITCH];
}
