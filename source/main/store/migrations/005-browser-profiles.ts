export const browserProfilesSql = `
ALTER TABLE setting RENAME TO setting_before_browser_profiles;
CREATE TABLE setting (
	key TEXT PRIMARY KEY CHECK (key IN (
		'publicBrowsingEnabled', 'defaultMode', 'editor', 'nanocoderOverridePath',
		'theme', 'browserProfiles', 'browserAssignments'
	)),
	value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
INSERT INTO setting (key, value) SELECT key, value FROM setting_before_browser_profiles;
DROP TABLE setting_before_browser_profiles;
`;
