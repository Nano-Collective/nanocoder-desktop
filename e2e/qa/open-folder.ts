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

// Waits for a visible outcome (ACP ready, a failure alert or retry), then for the command to be enabled.
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
	const search = page.getByRole('combobox', {
		name: 'find a command',
		exact: true,
	});
	await expect
		.poll(
			async () =>
				(await page.locator('.ui-badge--acp-ready').first().isVisible()) ||
				(await page.getByRole('alert').first().isVisible()) ||
				(await page
					.getByRole('button', {name: 'retry Nanocoder', exact: true})
					.first()
					.isVisible()),
			{timeout: 15_000},
		)
		.toBe(true);
	await trigger.click();
	await search.fill('open a project folder');
	await expect(command).not.toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await expect(palette).toBeHidden();
}
