export const nanocoderBrowserSql = `
ALTER TABLE setting RENAME TO setting_before_nanocoder_browser;
CREATE TABLE setting (
	key TEXT PRIMARY KEY CHECK (key IN (
		'publicBrowsingEnabled', 'defaultMode', 'editor', 'nanocoderOverridePath',
		'theme', 'browserProfiles', 'browserAssignments', 'nanocoderBrowserEnabled'
	)),
	value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
INSERT INTO setting (key, value) SELECT key, value FROM setting_before_nanocoder_browser;
DROP TABLE setting_before_nanocoder_browser;
`;
