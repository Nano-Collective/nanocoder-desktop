import {checkPage, pageOrigin} from '@/main/browser/origin';
import type {SiteAccess} from '@/main/browser/site-access';
import type {NanocoderMode, PermissionOptionKind} from '@/shared/ipc';

// A refusal the agent may read: its message names the rule and never carries page detail.
export class AgentRefusal extends Error {}

export interface AgentContext {
	projectId: string;
	sessionId: string | null;
}

export interface AgentQuestion {
	title: string;
	options: Array<{id: string; name: string; kind: PermissionOptionKind}>;
}

// Shows a question in the chat's approval shelf; null when it was not answered or could not be asked.
export type AgentAsk = (
	context: AgentContext,
	question: AgentQuestion,
	signal?: AbortSignal,
) => Promise<string | null>;

export interface AgentPolicy {
	// Resolves when the agent may use the address, asking the user where the rules say so.
	admit(
		context: AgentContext,
		url: string,
		signal?: AbortSignal,
	): Promise<void>;
	// The same rules without asking, for navigations a page starts during an action.
	admitted(context: AgentContext, url: string): boolean;
	approve(
		context: AgentContext,
		title: string,
		signal?: AbortSignal,
	): Promise<boolean>;
}

const LOCAL_ONLY =
	'Agent control is limited to local addresses (localhost, 127.x.x.x and [::1]).';

function checked(url: string): {local: boolean; origin: string} {
	const verdict = checkPage(url, {publicSites: true});
	if (!verdict.allowed)
		throw new AgentRefusal(
			verdict.reason === 'scheme'
				? 'Only http and https pages open in the in-app browser.'
				: 'That is not a valid http or https address.',
		);
	return {local: verdict.local, origin: pageOrigin(url) ?? url};
}

export const localOnlyPolicy: AgentPolicy = {
	admit: async (_context, url) => {
		if (!checked(url).local) throw new AgentRefusal(LOCAL_ONLY);
	},
	admitted: (_context, url) => {
		try {
			return checked(url).local;
		} catch {
			return false;
		}
	},
	approve: async () => false,
};

const SITE_OPTIONS: AgentQuestion['options'] = [
	{id: 'thread', name: 'allow for this chat', kind: 'allow_once'},
	{id: 'always', name: 'always allow', kind: 'allow_always'},
	{id: 'block', name: 'block', kind: 'reject_once'},
];
const APPROVE_OPTIONS: AgentQuestion['options'] = [
	{id: 'allow', name: 'allow once', kind: 'allow_once'},
	{id: 'reject', name: 'reject', kind: 'reject_once'},
];

export function createAgentPolicy(options: {
	publicSites(): boolean;
	mode(context: AgentContext): NanocoderMode | undefined;
	ask: AgentAsk;
	sites: SiteAccess;
}): AgentPolicy {
	// The rules that need no question: the setting (BRW-03) and normal mode (BRW-16, SEC-11).
	const publicRule = (context: AgentContext): string | null => {
		if (!options.publicSites())
			return 'Public sites are off in the desktop. The user can allow them in the browser tab.';
		const mode = options.mode(context);
		if (mode !== 'normal')
			return `The agent can use public sites only in normal mode; this chat is in ${mode ?? 'an unknown mode'}.`;
		return null;
	};
	const state = (context: AgentContext, origin: string) =>
		context.sessionId === null
			? 'unknown'
			: options.sites.state(context.sessionId, origin);

	return {
		admit: async (context, url, signal) => {
			const {local, origin} = checked(url);
			if (local) return;
			const broken = publicRule(context);
			if (broken) throw new AgentRefusal(broken);
			const known = state(context, origin);
			if (known === 'allowed') return;
			if (known === 'blocked')
				throw new AgentRefusal(`The user blocked ${origin} for this chat.`);
			const answer = await options.ask(
				context,
				{
					title: `Let the agent use ${origin} in the in-app browser?`,
					options: SITE_OPTIONS,
				},
				signal,
			);
			const sessionId = context.sessionId;
			if (answer === 'thread' && sessionId)
				options.sites.allowThread(sessionId, origin);
			else if (answer === 'always' && sessionId) {
				if (!options.sites.allowAlways(origin))
					options.sites.allowThread(sessionId, origin);
			} else if (answer === 'block' && sessionId) {
				options.sites.block(sessionId, origin);
				throw new AgentRefusal(`The user blocked ${origin} for this chat.`);
			} else throw new AgentRefusal(`The user did not allow ${origin}.`);
		},
		admitted: (context, url) => {
			try {
				const {local, origin} = checked(url);
				return (
					local ||
					(publicRule(context) === null && state(context, origin) === 'allowed')
				);
			} catch {
				return false;
			}
		},
		approve: async (context, title, signal) =>
			(await options.ask(
				context,
				{title, options: APPROVE_OPTIONS},
				signal,
			)) === 'allow',
	};
}
