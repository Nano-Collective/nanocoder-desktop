export const sessionRetentionSql = `
ALTER TABLE thread ADD COLUMN session_pinned INTEGER NOT NULL DEFAULT 0
	CHECK (session_pinned IN (0, 1));
CREATE TRIGGER thread_session_unpin AFTER UPDATE OF nanocoder_session_id ON thread
WHEN OLD.nanocoder_session_id IS NOT NEW.nanocoder_session_id
BEGIN
	UPDATE thread SET session_pinned = 0 WHERE id = NEW.id;
END;
CREATE TABLE nanocoder_retention (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
	max_sessions INTEGER NOT NULL CHECK (max_sessions BETWEEN 1 AND 1000000)
) STRICT;
`;
