# Git review

Real Git status and diffs, honest last-turn labelling, and the proposed baseline from #109.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## Purpose

Review must represent the repository, not only what the agent says it changed ([whitepaper, Git diff and review][wp-git]). Visual design: see [`DESIGN.md`](../../DESIGN.md).

## v1 requirements

| ID | Requirement | Status and source |
|---|---|---|
| GIT-01 | Detect whether the project is a Git work tree and whether a usable `git` is installed; show which `git` is used. | Suggestion (not discussed) |
| GIT-02 | Read status with NUL-delimited porcelain output, covering staged, unstaged, untracked, renamed, added and deleted entries. | Decided ([whitepaper][wp-git]) |
| GIT-03 | Filter staged and unstaged changes. | Decided ([whitepaper][wp-git]) |
| GIT-04 | Show a unified text diff per file within size limits; show binary, rename, add and delete states without a text diff. | Decided ([whitepaper][wp-git]) |
| GIT-05 | Label files touched by the latest Nanocoder turn, from tool call locations (and `timeline/list` when available), and show their current repository diff. | Decided ([whitepaper, Honest last-turn labelling][wp-git]) |
| GIT-06 | Refresh from the real work tree and index on file changes, turn completion and manual refresh. | Decided ([whitepaper][wp-git]) |
| GIT-07 | Select a line range, add a comment, and insert both transiently into the composer. | Decided ([whitepaper][wp-git]) |
| GIT-08 | Open the file in the external editor. | Decided ([whitepaper][wp-git]) |
| GIT-09 | "Agent changes" view: diff each touched file against Nanocoder's pre-edit snapshot. | Proposed (awaiting @will-lamerton) ([#109][i109], `DEC-14`) |
| GIT-10 | Where no snapshot exists, fall back to the touched-files label and say why. | Proposed (awaiting @will-lamerton) ([#109][i109]) |
| GIT-11 | Every Git call uses an argument array, no pager, no external diff, no text conversion, and repository execution hooks off (`SEC-06`). | Decided in part ([whitepaper][wp-git]) |
| GIT-12 | Record `HEAD` before and after each turn; if it moved (for example Nanocoder's `autoCommit`), show the commits made during the turn. | Suggestion (not discussed) |
| GIT-13 | Without Git, review is disabled with a reason; the file browser still works. | Suggestion (not discussed) |
| GIT-14 | No staging, discarding, committing, branching or worktrees in v1. | Decided ([whitepaper][wp-git]) |

## Behaviour

### Commands

All with an argument array, `--no-pager` behaviour (`GIT_PAGER=cat`), and `-c core.fsmonitor=false` (`SEC-06`). Suggestion (not discussed):

| Purpose | Command |
|---|---|
| Is this a work tree? | `git rev-parse --is-inside-work-tree` |
| Status | `git status --porcelain=v2 -z --untracked-files=all` |
| Unstaged diff for one file | `git diff --no-ext-diff --no-textconv -- <path>` |
| Staged diff for one file | `git diff --cached --no-ext-diff --no-textconv -- <path>` |
| Current `HEAD` | `git rev-parse HEAD` |
| Commits made during a turn | `git log --format=%H%x00%s -z <head_before>..<head_after>` |

Every diff command also turns off Git's ANSI escape output with the matching `git diff` option, because a repository's configuration can force it on even when output is not a terminal.

### Status mapping

From porcelain v2 records ([Git documentation][git-status]): ordinary changes (`1`) give staged and unstaged states per side; renames and copies (`2`) give the old and new path; unmerged entries (`u`) mark a conflict; `?` is untracked and `!` is ignored. The review list shows one row per path with its staged state, unstaged state and, for renames, the old path.

### Limits

Suggestion (not discussed), covered by `PERF-07` and `PERF-08`:

| Limit | Default | When hit |
|---|---|---|
| Status time | 5 seconds | `LIMIT` with "repository too large to scan"; manual retry. |
| Changed files listed | 5,000 | "N more not shown". |
| Diff size per file | 1 MiB of diff output | `LIMIT`; "Open in editor" offered. |

## Agent changes view

Proposed in [#109][i109-c]: Nanocoder already saves a copy of each file before the agent edits it (the `timeline/revert` mechanism). A small new ACP method would let the desktop read those copies as the baseline.

Limits found in source at `8a5f4d4`, which the fallback (`GIT-10`) must cover:

- Binary files are never snapshotted ([source][nc-binary]).
- At most 50 entries per session; older ones are pruned ([constants][nc-consts]).
- Timeline folders older than 7 days, or beyond 20 sessions, are pruned ([constants][nc-consts]).
- Shell commands get a snapshot only if a Git scan before the command is complete and available ([source][nc-opaque]).
- Snapshots live in the project at `.nanocoder/timeline/<sessionId>/`, which Nanocoder gitignores ([source][nc-gitignore]).
- `timeline/list` works only on a session loaded in the current process.

The whitepaper lists exact per-turn attribution under "Later" ([Next steps][wp-next]). Accepting `DEC-14` moves it into Milestone 2.

## Explicit deferrals

Destructive Git actions, branch comparison, GitHub comments, worktrees, merge and handoff flows ([whitepaper][wp-git]).

## Edge cases and failure modes

- User and agent edits in the same file: the full diff shows both; only `GIT-09` separates them.
- `nanocoder.autoCommit` on ([docs][nc-autocommit]): agent edits become commits, so the work-tree diff is empty (`GIT-12`).
- Nanocoder creating `.nanocoder/.gitignore` shows as a new untracked file the first time.
- Very large diffs, generated files, line-ending-only changes, submodules, a repository in the middle of a merge or rebase, a detached `HEAD`, an index lock held by another Git process.

## Platform notes

- **Windows.** Git for Windows path and line-ending settings (`core.autocrlf`) change diffs; show what Git reports.
- **macOS.** The Apple-provided `git` may be a stub that prompts to install developer tools; detect and explain (`GIT-01`).

## Security notes

`SEC-06`, `SEC-17` (a cloned repository can configure commands Git runs). See [`security.md`](../security.md).

## Dependencies on Nanocoder changes

A snapshot-read ACP method for `GIT-09` ([`acp-integration.md`](../acp-integration.md#nanocoder-changes-needed)).

## Open questions

`OQ-05` (diff library), `OQ-07` (editors), and whether `DEC-14` is v1.

## Acceptance criteria

| Criterion | Success item |
|---|---|
| After a turn edits files, the review lists them as touched and shows the real diff. | `SP-08` |
| Changes the user made outside the agent appear too. | `SP-08` |
| A selected range with a comment reaches the next prompt. | `SP-09` |

[wp-git]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L424-L452
[wp-next]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L687-L696
[i109]: https://github.com/Nano-Collective/docs/issues/109
[i109-c]: https://github.com/Nano-Collective/docs/issues/109#issuecomment-6202361982
[nc-binary]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/services/timeline-manager.ts#L196-L238
[nc-consts]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/constants.ts#L72-L74
[nc-opaque]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-timeline.ts#L140-L178
[nc-gitignore]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/utils/ensure-nanocoder-gitignore.ts
[nc-autocommit]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/configuration/index.md?plain=1#L275
[git-status]: https://git-scm.com/docs/git-status#_porcelain_format_version_2
