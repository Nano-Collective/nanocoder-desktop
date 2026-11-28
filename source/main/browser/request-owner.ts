// Service and shared workers send with no webContents id; the partition serves only this view, so theirs are its own (BRW-13).
export function fromView(
	webContentsId: number | undefined,
	viewId: number,
): boolean {
	return webContentsId === undefined || webContentsId === viewId;
}
