import {expect, type Page} from '@playwright/test';

export async function openSeededProject(
	page: Page,
	canonicalRoot: string,
	reload: () => Promise<unknown> = () => page.reload(),
): Promise<void> {
	await reload();
	await expect(page.locator('.project-switch-root')).toHaveText(canonicalRoot);
	const dialog = page.getByRole('dialog', {name: 'your projects'});
	if (!(await dialog.isVisible()))
		await page
			.getByRole('button', {name: 'switch project', exact: true})
			.click();
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByText('waiting for the project request or native dialog'),
	).toHaveCount(0);
	const recent = dialog.getByRole('region', {
		name: 'recent projects',
		exact: true,
	});
	await expect(recent).toBeVisible();
	await recent.getByRole('button', {name: 'open project', exact: true}).click();
	await expect(page.getByLabel('project trust feedback')).toContainText(
		'project ready',
	);
}
