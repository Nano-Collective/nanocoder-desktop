export const browserAgentSettingsSql = `
ALTER TABLE setting RENAME TO setting_before_browser_agent;
CREATE TABLE setting (
	key TEXT PRIMARY KEY CHECK (key IN (
		'publicBrowsingEnabled', 'defaultMode', 'editor', 'nanocoderOverridePath',
		'theme', 'browserProfiles', 'browserAssignments', 'nanocoderBrowserEnabled',
		'browserAllowedSites'
	)),
	value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
INSERT INTO setting (key, value) SELECT key, value FROM setting_before_browser_agent;
DROP TABLE setting_before_browser_agent;
`;
