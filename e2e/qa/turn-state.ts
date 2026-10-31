import type {Locator, Page} from '@playwright/test';

// The stop reason sits in a data attribute, so raw protocol text is never shown or announced.
export function turnEnded(page: Page): Locator {
	return page.locator(
		'section.conversation-stream[data-stop-reason="end_turn"]',
	);
}

// A cancel shows "turn interrupted" and also records the stop reason here.
export function turnCancelled(page: Page): Locator {
	return page.locator(
		'section.conversation-stream[data-stop-reason="cancelled"]',
	);
}
