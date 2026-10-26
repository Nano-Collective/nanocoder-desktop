# Data model

What the desktop stores in SQLite, how it migrates, and what it never stores.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## Principle

The desktop keeps a relational index for navigation and UI state. Nanocoder's session files remain the source of truth for conversation history ([whitepaper, Durable chats][wp-durable], Decided). Losing the desktop database loses navigation, never history.

## Requirements

| ID | Requirement | Status and source |
|---|---|---|
| DATA-01 | One SQLite database in the app's user data directory, opened only by the main process, with one writer. | SQLite recommended ([whitepaper][wp-alt]); acceptance Open (`OQ-04`) |
| DATA-02 | Tables follow the whitepaper's ER diagram, with the columns and keys below. | Decided ([whitepaper][wp-durable]); additions marked |
| DATA-03 | Schema changes are forward-only, numbered migrations, each in a transaction, with a copy of the database taken before the first migration of a new version. | Suggestion (not discussed) |
| DATA-04 | Never store full ACP messages, file contents, tool results or stderr. | Decided ([whitepaper, Sources of truth][wp-truth]) |
| DATA-05 | Store touched files as project-relative paths only. | Suggestion (not discussed) |
| DATA-06 | Browser cookies, storage, cache and history live in an Electron partition, never in SQLite. | Decided ([whitepaper][wp-truth]) |
| DATA-07 | Removing a project or thread from the desktop removes desktop rows only. Deleting the Nanocoder session needs a separate, explicit confirmation (`CHAT-14`). | Suggestion (not discussed) |
| DATA-08 | On startup, run an integrity check. If the database is unusable, move it aside and start empty; threads can be rediscovered from `session/list` (`ACP-18`). | Suggestion (not discussed) |
| DATA-09 | App settings (public browsing enabled, default mode, editor choice, Nanocoder override path) are stored in a settings table, never secrets. | Suggestion (not discussed) |
| DATA-10 | Window and panel state is stored as opaque UI state, not modelled here. | Decided (desktop owns it, [whitepaper][wp-split]) |

## Tables

Columns in the whitepaper's diagram are Decided. Columns marked "added" are Suggestion (not discussed).

| Table | Column | Type | Notes |
|---|---|---|---|
| `project` | `id` | text, primary key | Desktop-generated UUID. |
| | `canonical_root` | text, unique | Real path used for every security check (`SEC-03`). |
| | `session_cwd` | text | Directory passed to ACP. Usually equal to the root. |
| | `display_name` | text | |
| | `trusted` | integer (boolean) | Desktop trust flag (`CHAT-02`, `OQ-14`). |
| | `last_opened_at` | text (ISO 8601) | Indexed for the recent list. |
| | `created_at` | text | Added. |
| `thread` | `id` | text, primary key | |
| | `project_id` | text, foreign key to `project.id`, `ON DELETE CASCADE` | Indexed. |
| | `nanocoder_session_id` | text, unique | Durable join key (`DEC-34`). |
| | `title` | text | Cached from `_nanocoder/sessionTitleChanged` or rename. |
| | `archive_state` | text: `active`, `archived` | UI metadata, not lifecycle. |
| | `run_state` | text: the seven thread states | Last known state, so a crash is visible on next launch. |
| | `last_activity_at` | text | Indexed with `project_id`. |
| | `session_cwd` | text | Added: the cwd this session was created with, since Nanocoder resumes in the persisted directory. |
| | `view_only_reason` | text, nullable | Added: why the thread is view-only. |
| `turn_summary` | `id` | text, primary key | |
| | `thread_id` | text, foreign key, cascade | Indexed. |
| | `status` | text: `completed`, `cancelled`, `failed` | |
| | `touched_files` | JSON array of relative paths | `DATA-05`. |
| | `started_at`, `ended_at` | text | Added. Used to find commits made during a turn (`GIT-12`). |
| | `head_before`, `head_after` | text, nullable | Added: Git `HEAD` before and after the turn. |
| `agent_run` | `id` | text, primary key | |
| | `thread_id` | text, foreign key, cascade | Indexed. |
| | `parent_run_id` | text, nullable, foreign key to `agent_run.id` | |
| | `nanocoder_child_id` | text, nullable | Empty until Nanocoder exposes child IDs (`OQ-03`). |
| | `role` | text | Subagent name, for example `explore`. |
| | `status` | text | |
| `terminal_session` | `id`, `project_id`, `cwd`, `state` | | No scrollback (`TERM-09`). |
| `browser_tab` | `id`, `project_id`, `url`, `title` | | v1 has one tab. URLs can be sensitive; cleared with browser data (`BRW-08`). |
| `setting` | `key` text primary key, `value` JSON | | Added (`DATA-09`). |
| `schema_migration` | `version` integer primary key, `applied_at` | | Added (`DATA-03`). |

## Indexes

| Table | Index | Serves |
|---|---|---|
| `project` | `last_opened_at` | Recent projects list |
| `thread` | `(project_id, archive_state, last_activity_at)` | Thread list per project |
| `thread` | `nanocoder_session_id` (unique) | Resume and discovery joins |
| `turn_summary` | `(thread_id, ended_at)` | Latest turn's touched files |
| `agent_run` | `(thread_id, parent_run_id)` | Run tree |

## Retention of desktop rows

Suggestion (not discussed):

- Threads stay until the user removes them, even when their Nanocoder session is gone (they become view-only).
- `turn_summary` keeps the most recent 200 turns per thread; older rows are deleted at startup.
- `agent_run` rows are deleted with their thread.
- `browser_tab` rows are deleted when browser data is cleared (`BRW-08`).

## Privacy review of stored columns

| Column | Could it hold sensitive data? | Mitigation |
|---|---|---|
| `thread.title` | Yes: generated from the first prompt | Stored locally only; removed with the thread. |
| `turn_summary.touched_files` | Paths can reveal project structure | Relative paths only (`DATA-05`). |
| `browser_tab.url` | Yes: query strings can hold tokens | Cleared with browser data; Suggestion: strip query strings before storing. |
| `project.canonical_root` | Reveals local folder names | Local only; never sent anywhere. |
| `setting` | Must never hold secrets | Schema check refuses keys that look like credentials. |

## What is never stored

Decided (`DATA-04`): transcripts and message text, file contents, tool inputs and results, stderr. Also not stored, Suggestion (not discussed): terminal output, page content and screenshots, permission request payloads, and titles of Nanocoder sessions from projects the user has not added.

## Migrations

Suggestion (not discussed): migrations live as numbered files in the source tree, run at startup before any window opens, and refuse to run against a database from a newer app version (the user is told to update instead).

## Browser partition

Open (whitepaper question 6, `OQ-06`): one app-wide persistent partition, or one per project.

| Option | For | Against |
|---|---|---|
| App-wide | One sign-in for a staging site works across projects; simplest. | A page in one project can see cookies set while previewing another; clearing data clears everything. |
| Per project | Isolation between clients' projects; clearing one project's data is precise. | More partitions on disk; repeated sign-ins. |

Either way the partition is persistent, separate from the user's normal browser profile, and cleared from settings (`BRW-05`, `BRW-08`).

## SQLite library

Decided in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3) (`DEC-04`): `node:sqlite`, with `better-sqlite3` as the fallback behind the same interface. In the check posted on #3, `node:sqlite` opened an in-memory database and a WAL file in Electron 45.0.0 on Windows. It is a release candidate on Node 24.15 and later and still active development on Node 22, so store specs run on Node 24 as well. The candidates considered:

| Candidate | Notes |
|---|---|
| `better-sqlite3` (13.0.3, MIT, fallback) | Synchronous API, widely used with Electron. Native module: needs a rebuild against Electron's ABI on every Electron upgrade. |
| Node's built-in `node:sqlite` (chosen) | No native dependency. Electron 45.0.0 embeds Node 24.22.0 ([releases][el-releases]). Release candidate on Node 24.15 and later. |
| SQLite compiled to WebAssembly | No native rebuild. Slower, and persistence needs care. |

[wp-alt]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L517-L531
[wp-durable]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L286-L342
[wp-truth]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L344-L355
[wp-split]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L248-L265
[el-releases]: https://releases.electronjs.org/release/v45.0.0
