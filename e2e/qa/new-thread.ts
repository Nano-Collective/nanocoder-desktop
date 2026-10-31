import {expect, type Locator, type Page} from '@playwright/test';

// New thread opens the D1 dialog; keeping the draft creates the thread.
export async function createDraftThread(page: Page, trigger: Locator) {
	await trigger.click();
	const dialog = page.getByRole('dialog', {name: 'new thread', exact: true});
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole('button', {name: 'keep as new thread draft', exact: true})
		.click();
	await expect(dialog).toBeHidden();
}
