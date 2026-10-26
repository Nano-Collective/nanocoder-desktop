# Chats and sessions

Projects, threads, durable resume, view-only threads, approvals, and model and mode controls.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## Purpose

Let the user add a project, start or resume durable Nanocoder chats, follow each turn as it streams, approve or reject protected operations, and pick up the same chat after a full restart ([whitepaper, v1 scope][wp-scope], items 1, 2 and 7). Visual design: see [`DESIGN.md`](../../DESIGN.md).

## v1 requirements

| ID | Requirement | Status and source |
|---|---|---|
| CHAT-01 | Add a project by choosing a folder in a main-process picker. Store its canonical root, session cwd and display name. Git is not required; Git review is disabled without it (`GIT-13`). | Decided ([whitepaper][wp-identity]) |
| CHAT-02 | Ask the user to trust a project before starting Nanocoder, Git or watchers in it. | Open (`OQ-14`) |
| CHAT-03 | List a project's threads by last activity, with archived threads separate. | Decided ([whitepaper][wp-states]) |
| CHAT-04 | A new thread calls `session/new` on first prompt and stores the session ID before showing anything else. | Decided ([whitepaper][wp-durable]) |
| CHAT-05 | Stream user messages, reasoning, agent messages, tool calls, tool updates (with diffs when Nanocoder sends them) and available commands, in order. | Decided ([whitepaper][wp-scope]) |
| CHAT-06 | Show each permission request with Nanocoder's own options; the turn waits until the user answers or cancels. | Decided ([whitepaper][wp-threat]) |
| CHAT-07 | Cancel a running turn (`ACP-09`). | Decided ([whitepaper][wp-states]) |
| CHAT-08 | After the app and Nanocoder restart, opening a thread resumes it with `session/resume` and the next prompt continues with the model context intact (`SP-06`). | Decided ([whitepaper][wp-resume]) |
| CHAT-09 | A thread whose session is missing becomes view-only: it shows desktop metadata (title, last activity, touched files), says why, and offers "start a new thread in this project" and "remove". | Decided ([whitepaper][wp-states]); actions are Suggestion (not discussed) |
| CHAT-10 | Model and provider controls use Nanocoder's config options, are labelled as applying to the whole project, and are disabled while any turn in the project runs (`ACP-14`). | Decided that model state is process-global ([whitepaper][wp-risks]); the guard is Suggestion (not discussed) |
| CHAT-11 | A mode control offers Nanocoder's five modes, is set explicitly on every new or resumed session, and changes only between turns (`ACP-13`). | Open (`OQ-15`) |
| CHAT-12 | Titles come from `_nanocoder/sessionTitleChanged`; the user can rename through `renameSession` when available. | Suggestion (not discussed), based on [#122][pr122] |
| CHAT-13 | Archive and unarchive are desktop metadata only. | Decided ([whitepaper][wp-states]) |
| CHAT-14 | "Remove from desktop" removes desktop rows. "Delete chat history" also calls `session/delete`, after a separate confirmation. | Suggestion (not discussed) |
| CHAT-15 | Process failures, unsupported capabilities and version problems are shown in the thread and the project, with the redacted diagnostics available. | Decided ([whitepaper, Engineering requirements][wp-scope]) |
| CHAT-16 | The composer sends text plus attached resources: files from the browser (`FILE-08`), review comments (`GIT-07`) and the browser URL and title (`BRW-10`). Attached context is transient: it goes into the prompt, not into desktop storage. | Decided ([whitepaper][wp-git-section]) |
| CHAT-17 | Only one root turn runs per project process. While one thread runs, other threads in the project can be read but not prompted, and say why. | Decided ([whitepaper, Process policy][wp-process]) |
| CHAT-18 | The conversation is fully keyboard operable; new content is announced to assistive technology at a polite rate; permission requests move focus to the request and are announced assertively. | Decided as a v1 goal ([whitepaper, Milestone 4][wp-next]); specifics are Suggestion (not discussed) |
| CHAT-19 | Show per-turn usage and cost when Nanocoder provides it in `_meta`. Show a context-window gauge only when Nanocoder reports context use; at `8a5f4d4` it sends per-turn token counts but no context-window figure, so the gauge stays hidden. | Suggestion (not discussed) |
| CHAT-20 | Offer Nanocoder's custom slash commands from `available_commands_update`. Do not present Nanocoder's built-in `/help` reply as desktop help, since it is written for the VS Code sidebar. | Suggestion (not discussed), based on [source][nc-slash] |
| CHAT-21 | `ask_user` questions render as selectable options only, since ACP permission options have no text input. | Decided by Nanocoder's behaviour ([docs][nc-acp-limits]) |

## Behaviour

### Composer by thread state

| Thread state | Composer | Notes |
|---|---|---|
| New | Enabled | The first send creates the session (`CHAT-04`). |
| Ready | Enabled, unless another thread in the project is running | Then disabled with "another thread is running" (`CHAT-17`). |
| Running | Disabled for sending; cancel available | Text the user types is kept as a draft. |
| WaitingApproval | Disabled; focus on the permission request (`A11Y-02`) | |
| Interrupted | Enabled | |
| Failed | Disabled until the process is back | Retry offered. |
| ViewOnly | Hidden | Recovery actions instead (`CHAT-09`). |

### Permission requests

Nanocoder sends the options; the desktop shows them as given. ACP defines four option kinds: `allow_once`, `allow_always`, `reject_once` and `reject_always` (SDK 1.4.0 schema). Each request shows the tool call it belongs to, its kind and the files or command it names. "Always" options change Nanocoder's policy, not the desktop's, so the request says so.

### Stop reasons

ACP stop reasons are `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` and `cancelled` (SDK 1.4.0 schema). Every reason other than `end_turn` and `cancelled` is shown to the user with a plain explanation, and the thread returns to Ready.

### Importing existing sessions

When a project is opened, sessions found by discovery (`ACP-18`) that the desktop does not know yet are offered for import, newest first, with their titles. Importing creates a thread row only; nothing is copied from the session.

### Titles and rename

A new thread is titled from Nanocoder's generated title when `_nanocoder/sessionTitleChanged` arrives, otherwise from the first prompt (truncated). A user rename goes through `renameSession` and wins over later generated titles, which matches Nanocoder's own `titleManuallySet` handling.

## Explicit deferrals

Full-text thread search, pinning, parallel root turns, forking a thread, editing a past prompt, image attachments, and continuing a chat in Scriptura ([#118][i118]).

## Edge cases and failure modes

- **Missing session on resume.** Nanocoder deleted it (retention, `OQ-16`) or the user deleted it elsewhere. ViewOnly (`CHAT-09`).
- **Session saved by another client.** The same session can be open in the Nanocoder CLI or VS Code. Nanocoder now locks its session index across processes, but two clients writing the same session file is not prevented. Suggestion (not discussed): warn when the session's `lastAccessedAt` changes while the thread is open.
- **Crash mid-turn.** Replay shows the last saved state, not the partial stream ([`architecture.md`](../architecture.md#crash-recovery)).
- **Prompt while another thread runs.** Refused with `BUSY` (`CHAT-17`). Nanocoder alone would run both.
- **Model change mid-turn.** Disabled (`CHAT-10`).
- **Mode change mid-turn.** Disabled until Nanocoder applies or rejects it ([nanocoder#1857][nc1857]).
- **Nanocoder fails to start.** No provider, untrusted folder, wrong version: show Nanocoder's stderr message with a fix (`CHAT-15`).
- **Project moved or renamed on disk.** The canonical root no longer resolves; the project is marked missing and offers "locate".
- **Lessons from the VS Code client.** Bugs filed against Nanocoder's VS Code ACP client apply here too: switching sessions without waiting for the active prompt ([nanocoder#1717][nc1717]), a failed resume clearing the transcript ([nanocoder#1718][nc1718]), a restart that does not re-sync ([nanocoder#1719][nc1719]), and success notices for failed provider switches ([nanocoder#1721][nc1721]).

## Platform notes

- **macOS.** Nanocoder expands `$VAR` and `${VAR}` references in its configuration from the process environment ([source][nc-env]). An app started from the Dock or Finder does not run the user's shell profile, so keys exported there are missing. The desktop passes its own environment through (`SEC-05`); setup notes must tell users to set provider keys in Nanocoder's config or in a `.env` file in the project root, which Nanocoder loads from its working directory at startup, with shell variables taking precedence ([source][nc-dotenv]).
- **Windows.** Paths in session files may differ in case from the canonical root ([nanocoder#1689][nc1689], open). Compare case-insensitively.
- **Linux.** No platform-specific behaviour expected.

## Security notes

See [`security.md`](../security.md): `SEC-02` (IPC), `SEC-07` (no transcripts stored), `SEC-09` (approvals), `SEC-17` (trust before running project code).

## Dependencies on Nanocoder changes

`session/close` (merged), `set_mode` mid-turn ([nanocoder#1857][nc1857]), retention handling (`OQ-16`). See [`acp-integration.md`](../acp-integration.md#nanocoder-changes-needed).

## Open questions

`OQ-14` (trust), `OQ-15` (starting mode), `OQ-16` (retention), `OQ-19` (switching project mid-turn).

## Acceptance criteria

| Criterion | Success item |
|---|---|
| A real repository opens and its threads list. | `SP-02` |
| A new thread streams messages, reasoning and tool cards from a real provider. | `SP-03` |
| A protected tool shows a permission request; allowing and rejecting both behave as Nanocoder reports. | `SP-04` |
| After quitting the app and ending Nanocoder, the same thread resumes and the next answer uses earlier context. | `SP-06` |
| A thread whose session file was removed opens view-only with a reason. | `SP-06` |

[wp-scope]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L102-L126
[wp-states]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L168-L187
[wp-process]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L277-L284
[wp-durable]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L286-L355
[wp-resume]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L357-L387
[wp-identity]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L389-L398
[wp-git-section]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L400-L452
[wp-threat]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L585-L633
[wp-risks]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L635-L648
[wp-next]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L650-L696
[pr122]: https://github.com/Nano-Collective/docs/pull/122
[i118]: https://github.com/Nano-Collective/docs/issues/118
[nc-slash]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L252-L371
[nc-acp-limits]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L84-L88
[nc1689]: https://github.com/Nano-Collective/nanocoder/issues/1689
[nc1717]: https://github.com/Nano-Collective/nanocoder/issues/1717
[nc1718]: https://github.com/Nano-Collective/nanocoder/issues/1718
[nc1719]: https://github.com/Nano-Collective/nanocoder/issues/1719
[nc1721]: https://github.com/Nano-Collective/nanocoder/issues/1721
[nc1857]: https://github.com/Nano-Collective/nanocoder/issues/1857
[nc-env]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/config/env-substitution.ts#L4-L30
[nc-dotenv]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/config/index.ts#L55-L66
