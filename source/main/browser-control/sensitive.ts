// Facts the page script reports about a target; the decision is made here, in main.
export interface TargetFacts {
	tag: string;
	type: string;
	role: string;
	name: string;
	id: string;
	autocomplete: string;
	label: string;
	submits: boolean;
	download: boolean;
	editable: boolean;
	disabled: boolean;
}

export type Risk =
	| 'submit'
	| 'download'
	| 'file'
	| 'wording'
	| 'password'
	| 'payment'
	| 'one-time-code';

// Conservative on purpose: a false positive costs a refusal, a false negative can cost money or data.
const WORDING =
	/\b(buy|purchase|pay|payment|checkout|check out|place order|order now|delete|remove|destroy|erase|confirm|transfer|donate|subscribe|unsubscribe|deactivate|close account)\b/i;
const IDENTIFIER_WORDING =
	/(^|[^a-z])(buy|purchase|pay|checkout|delete|remove|destroy|confirm|transfer|unsubscribe)([^a-z]|$)/i;
const PAYMENT =
	/card|cc-?(num|number|exp|csc|cvc)|cvv|cvc|csc|iban|expir|security[-_ ]?code/i;
const ONE_TIME = /otp|one[-_ ]?time|totp|2fa|verification[-_ ]?code/i;

function wording(facts: TargetFacts): boolean {
	return (
		WORDING.test(facts.label) ||
		IDENTIFIER_WORDING.test(facts.name) ||
		IDENTIFIER_WORDING.test(facts.id)
	);
}

export function clickRisks(facts: TargetFacts): Risk[] {
	const risks: Risk[] = [];
	if (facts.submits) risks.push('submit');
	if (facts.download) risks.push('download');
	if (facts.tag === 'input' && facts.type === 'file') risks.push('file');
	if (wording(facts)) risks.push('wording');
	return risks;
}

export function typeRisks(facts: TargetFacts): Risk[] {
	const autocomplete = facts.autocomplete.toLowerCase();
	const identifiers = `${facts.name} ${facts.id}`;
	const risks: Risk[] = [];
	if (facts.type === 'file') risks.push('file');
	if (
		facts.type === 'password' ||
		/(^|\s)(current|new)-password(\s|$)/.test(autocomplete)
	)
		risks.push('password');
	if (/(^|\s)cc-/.test(autocomplete) || PAYMENT.test(identifiers))
		risks.push('payment');
	if (
		/(^|\s)one-time-code(\s|$)/.test(autocomplete) ||
		ONE_TIME.test(identifiers)
	)
		risks.push('one-time-code');
	return risks;
}

const WORDS: Record<Risk, string> = {
	submit: 'it would submit a form',
	download: 'it would start a download',
	file: 'it would choose a file to upload',
	wording: 'its wording suggests a purchase, payment, deletion or confirmation',
	password: 'it is a password field',
	payment: 'it is a payment field',
	'one-time-code': 'it is a one-time code field',
};

export function describeRisks(risks: readonly Risk[]): string {
	return risks.map(risk => WORDS[risk]).join(', and ');
}
