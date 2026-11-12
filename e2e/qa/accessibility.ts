export interface AxNode {
	ignored?: boolean;
	role?: {value?: unknown};
	name?: {value?: unknown};
}

// Roles a user can operate. Each must be exposed with a name (WCAG 4.1.2, A11Y-03).
export const INTERACTIVE_ROLES = new Set([
	'button',
	'link',
	'textbox',
	'searchbox',
	'combobox',
	'listbox',
	'option',
	'checkbox',
	'radio',
	'switch',
	'tab',
	'treeitem',
	'menuitem',
	'slider',
	'spinbutton',
	'DisclosureTriangle',
]);

export function unnamedInteractive(nodes: readonly AxNode[]): string[] {
	return nodes
		.filter(
			node =>
				!node.ignored &&
				INTERACTIVE_ROLES.has(String(node.role?.value)) &&
				String(node.name?.value ?? '').trim() === '',
		)
		.map(node => String(node.role?.value));
}

// Pressing Tab many times should visit more than two elements; two or fewer is a keyboard trap (A11Y-01).
export function focusTrap(sequence: readonly string[]): boolean {
	return sequence.length >= 4 && new Set(sequence).size <= 2;
}

export function interactiveCount(nodes: readonly AxNode[]): number {
	return nodes.filter(
		node => !node.ignored && INTERACTIVE_ROLES.has(String(node.role?.value)),
	).length;
}
