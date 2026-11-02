export const threadExecutionIdentitiesSql = `
CREATE TABLE thread_history (
	thread_id TEXT PRIMARY KEY REFERENCES thread(id) ON DELETE CASCADE,
	session_id TEXT NOT NULL,
	revision INTEGER NOT NULL CHECK (revision > 0),
	generation INTEGER NOT NULL CHECK (generation >= 0),
	sequence INTEGER NOT NULL CHECK (sequence >= 0),
	complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
	UNIQUE(thread_id, session_id)
) STRICT;
CREATE TABLE thread_turn_identity (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
	outcome TEXT NOT NULL CHECK (outcome IN ('unknown','completed','failed','interrupted')),
	FOREIGN KEY (thread_id, session_id) REFERENCES thread_history(thread_id, session_id) ON DELETE CASCADE,
	UNIQUE(thread_id, session_id, ordinal),
	UNIQUE(id, thread_id, session_id)
) STRICT;
CREATE TABLE thread_execution_identity (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	turn_id TEXT NOT NULL,
	tool_call_id TEXT NOT NULL CHECK (length(tool_call_id) BETWEEN 1 AND 512),
	ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
	outcome TEXT NOT NULL CHECK (outcome IN ('unknown','completed','failed','interrupted')),
	FOREIGN KEY (turn_id, thread_id, session_id) REFERENCES thread_turn_identity(id, thread_id, session_id) ON DELETE CASCADE,
	UNIQUE(turn_id, tool_call_id),
	UNIQUE(turn_id, ordinal)
) STRICT;
`;
