// A refusal belongs to the folder its connect attempt picked, so only another folder's event clears it.
export function clearsConnectAlert(
	alertFolder: string | null,
	eventFolder: string,
): boolean {
	return alertFolder !== eventFolder;
}
