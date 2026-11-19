import * as React from 'react';

export function copyableCodeText(node: React.ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(copyableCodeText).join('');
	if (React.isValidElement<{children?: React.ReactNode}>(node))
		return copyableCodeText(node.props.children);
	return '';
}

export async function copyContent(
	text: string,
	write: (text: string) => Promise<void>,
	notify: (message: string) => void,
): Promise<boolean> {
	try {
		await write(text);
		notify('copied');
		return true;
	} catch {
		notify('copy failed. clipboard access was refused.');
		return false;
	}
}
