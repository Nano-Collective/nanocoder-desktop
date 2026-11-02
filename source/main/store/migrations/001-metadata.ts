export const metadataSql = `
CREATE TABLE schema_migration (
	version INTEGER PRIMARY KEY,
	applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE project (
	id TEXT PRIMARY KEY,
	canonical_root TEXT NOT NULL UNIQUE,
	session_cwd TEXT NOT NULL,
	display_name TEXT NOT NULL,
	trusted INTEGER NOT NULL CHECK (trusted IN (0, 1)),
	default_mode TEXT NOT NULL CHECK (
		default_mode IN ('normal', 'auto-accept', 'plan', 'architect')
	),
	last_opened_at TEXT NOT NULL,
	created_at TEXT NOT NULL
) STRICT;
CREATE INDEX project_recent ON project(last_opened_at);
CREATE TABLE thread (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
	nanocoder_session_id TEXT UNIQUE,
	title TEXT NOT NULL,
	archive_state TEXT NOT NULL CHECK (archive_state IN ('active', 'archived')),
	run_state TEXT NOT NULL CHECK (run_state IN (
		'new', 'ready', 'running', 'waiting-approval', 'interrupted', 'failed',
		'view-only'
	)),
	last_activity_at TEXT NOT NULL,
	session_cwd TEXT NOT NULL,
	mode TEXT NOT NULL CHECK (mode IN ('normal', 'auto-accept', 'plan', 'architect')),
	view_only_reason TEXT
) STRICT;
CREATE INDEX thread_activity ON thread(project_id, archive_state, last_activity_at);
CREATE TABLE turn_summary (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
	status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled', 'failed')),
	touched_files TEXT NOT NULL CHECK (json_valid(touched_files)),
	started_at TEXT NOT NULL,
	ended_at TEXT NOT NULL,
	head_before TEXT,
	head_after TEXT
) STRICT;
CREATE INDEX turn_summary_latest ON turn_summary(thread_id, ended_at);
CREATE TABLE agent_run (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
	parent_run_id TEXT REFERENCES agent_run(id) ON DELETE CASCADE,
	nanocoder_child_id TEXT,
	role TEXT NOT NULL,
	status TEXT NOT NULL
) STRICT;
CREATE INDEX agent_run_tree ON agent_run(thread_id, parent_run_id);
CREATE TABLE terminal_session (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
	cwd TEXT NOT NULL,
	state TEXT NOT NULL
) STRICT;
CREATE TABLE browser_tab (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
	url TEXT NOT NULL,
	title TEXT NOT NULL
) STRICT;
CREATE TABLE setting (
	key TEXT PRIMARY KEY CHECK (key IN (
		'publicBrowsingEnabled', 'defaultMode', 'editor', 'nanocoderOverridePath',
		'theme'
	)),
	value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
`;
