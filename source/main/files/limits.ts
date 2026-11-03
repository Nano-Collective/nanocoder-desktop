// One place for every bound the file service and ACP reads share (SEC-04).
export const FILE_LIMITS = {
	// Entries returned for one directory; the rest are counted, not listed.
	listEntries: 2_000,
	// Names read from one directory before the scan itself stops.
	scanEntries: 100_000,
	listMilliseconds: 2_000,
	previewBytes: 1_048_576,
	highlightBytes: 262_144,
	binarySniffBytes: 8_192,
	acpReadBytes: 1_048_576,
	acpReadMilliseconds: 5_000,
	pathBytes: 4_096,
	segmentBytes: 255,
} as const;
