export const MAX_DIFF_ROWS = 5_000;
export const DIFF_ROW_HEIGHT = 20.8;
export const DIFF_OVERSCAN = 8;

export interface DiffWindow {
	start: number;
	end: number;
	totalHeight: number;
}

export function diffWindow(
	rowCount: number,
	scrollTop: number,
	viewportHeight: number,
): DiffWindow {
	const count = Math.min(Math.max(0, rowCount), MAX_DIFF_ROWS);
	const top = Math.max(0, scrollTop);
	const height = Math.max(0, viewportHeight);
	const first = Math.floor(top / DIFF_ROW_HEIGHT);
	return {
		start: Math.max(0, first - DIFF_OVERSCAN),
		end: Math.min(
			count,
			Math.ceil((top + height) / DIFF_ROW_HEIGHT) + DIFF_OVERSCAN,
		),
		totalHeight: count * DIFF_ROW_HEIGHT,
	};
}

// The same minimal-scroll rule serves keyboard navigation and future find results.
export function scrollTopForRow(
	rowIndex: number,
	currentTop: number,
	viewportHeight: number,
	rowCount: number,
): number {
	const count = Math.min(Math.max(0, rowCount), MAX_DIFF_ROWS);
	if (rowIndex < 0 || rowIndex >= count) return currentTop;
	const rowTop = rowIndex * DIFF_ROW_HEIGHT;
	const rowBottom = rowTop + DIFF_ROW_HEIGHT;
	const maxTop = Math.max(0, count * DIFF_ROW_HEIGHT - viewportHeight);
	if (rowTop < currentTop) return Math.min(rowTop, maxTop);
	if (rowBottom > currentTop + viewportHeight)
		return Math.min(rowBottom - viewportHeight, maxTop);
	return Math.min(currentTop, maxTop);
}

export function diffRowKey(rowIndex: number): string {
	return `diff-row-${rowIndex}`;
}
