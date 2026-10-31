import {expect, type Page} from '@playwright/test';

// Starts the open-folder command from the header palette and waits for the palette to close.
// The welcome button exists only before a thread is open, so the palette is the entry in a thread.
export async function startFolderFromPalette(page: Page): Promise<void> {
	const palette = page.getByRole('dialog', {
		name: 'command palette',
		exact: true,
	});
	const trigger = page.getByRole('button', {
		name: 'command palette',
		exact: true,
	});
	const command = page.getByRole('option', {name: /open a project folder/});
	const search = page.getByRole('combobox', {
		name: 'find a command',
		exact: true,
	});
	await trigger.click();
	await search.fill('open a project folder');
	await expect(command).not.toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Enter');
	await expect(palette).toBeHidden();
}

// Also waits until the command is enabled again, so the folder has finished connecting.
export async function openFolderFromPalette(page: Page): Promise<void> {
	await startFolderFromPalette(page);
	const palette = page.getByRole('dialog', {
		name: 'command palette',
		exact: true,
	});
	const trigger = page.getByRole('button', {
		name: 'command palette',
		exact: true,
	});
	const command = page.getByRole('option', {name: /open a project folder/});
	await trigger.click();
	await page
		.getByRole('combobox', {name: 'find a command', exact: true})
		.fill('open a project folder');
	await expect(command).not.toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await expect(palette).toBeHidden();
}
