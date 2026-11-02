export const uiStateSql = `
CREATE TABLE ui_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
`;
