import {expect, type Page} from '@playwright/test';

export async function openSeededProject(
	page: Page,
	canonicalRoot: string,
	reload: () => Promise<unknown> = () => page.reload(),
): Promise<void> {
	await reload();
	await expect(page.locator('.project-switch-root')).toHaveText(canonicalRoot);
	await expect(page.locator('.recent-projects [role="status"]')).toHaveCount(0);
	const switcher = page.locator('.project-switcher');
	await expect(switcher).toBeVisible();
	if (
		!(await switcher.evaluate(element => (element as HTMLDetailsElement).open))
	)
		await page.getByLabel('switch project', {exact: true}).click();
	const recent = page.getByRole('region', {
		name: 'recent projects',
		exact: true,
	});
	await expect(recent).toBeVisible();
	await recent.getByRole('button', {name: 'open project', exact: true}).click();
	await expect(page.getByLabel('project trust feedback')).toContainText(
		'project ready',
	);
}
