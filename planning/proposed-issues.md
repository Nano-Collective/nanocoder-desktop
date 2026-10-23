# Proposed issues

Drafts of the issues and comments this plan needs raised, ready to post. Delete each draft once it is posted and linked from [`open-questions.md`](open-questions.md).

- Status: Draft
- Last updated: 2026-10-23
- Drafted by: @akramcodez

## How to use this file

- Docs issues use the `whitepaper:nanocoder-desktop` label and the title pattern the review issues already use.
- Nanocoder issues go on [Nano-Collective/nanocoder](https://github.com/Nano-Collective/nanocoder) with the repository's bug or feature template.
- Comments go on the existing thread named in the draft.
- Nothing here has been posted. Every fact is linked in the planning file named under "Source".

## Docs repository: new issues

### 1. Nanocoder's built-in browser tool

**Title:** Feedback for “Nanocoder Desktop”: Nanocoder's built-in browser tool bypasses the desktop browser boundary

**Source:** `OQ-13`, [`open-questions.md`](open-questions.md)

**Body:**

> **The problem.** Since nanocoder#1626 (merged 7 October), Nanocoder ships a `browser` tool that drives its own headless Chromium. It can reach public sites (it blocks private and metadata addresses) and asks for approval unless it is in `alwaysAllow`. The whitepaper's browser rules (localhost by default, public sites only after the user opts in, sensitive actions approved by the desktop) apply only to the desktop's own browser. In a desktop session the agent could use Nanocoder's tool instead.
>
> **Why it matters.** It sidesteps the boundary proposed in #108. The only off switch today is `nanocoder.disabledTools` in the user's config, and writing to user config is the option ruled out in #116.
>
> **What to clarify.** Which route: a per-session or command-line way to disable the tool (a Nanocoder change), routing it to the desktop's browser, or accepting two browsers and documenting the difference.

### 2. Desktop trust and Nanocoder directory trust

**Title:** Feedback for “Nanocoder Desktop”: How desktop project trust maps to Nanocoder's directory trust

**Source:** `OQ-14`

**Body:**

> **The problem.** Since nanocoder#1847, `nanocoder --acp` exits at startup when its working directory is not in Nanocoder's trusted list, unless `--trust-directory` is passed. The whitepaper gives the desktop "project roots and trust", so there are now two trust stores.
>
> **Why it matters.** Opening a project for the first time fails until this is settled (success item 2).
>
> **What to clarify.** One of: the desktop asks for trust and passes `--trust-directory` (as the VS Code extension does for trusted workspaces); the desktop sends the user to trust the folder in Nanocoder; or something else. Writing to Nanocoder's trust store from the desktop conflicts with Nanocoder owning its configuration.

### 3. Starting mode for desktop sessions

**Title:** Feedback for “Nanocoder Desktop”: ACP sessions start in auto-accept, so edits apply without approval

**Source:** `OQ-15`

**Body:**

> **The problem.** Nanocoder starts every ACP session in `auto-accept`, where file edits apply without a prompt. Success item 4 and the #108 proposal assume approvals happen, and #108 relies on `normal` mode to gate public-site control. A mode sent with `session/set_mode` during a turn is not applied to that turn (nanocoder#1857).
>
> **What to clarify.** Which mode desktop threads start in, and whether the user can change the default.

### 4. Session retention and durable threads

**Title:** Feedback for “Nanocoder Desktop”: Nanocoder's session retention deletes the sessions durable threads depend on

**Source:** `OQ-16`

**Body:**

> **The problem.** By default Nanocoder deletes sessions not accessed for 30 days, and the oldest once there are more than 100 (`sessions.retentionDays`, `sessions.maxSessions`). A desktop thread whose session is deleted can only become view-only.
>
> **What to clarify.** Accept and explain it; surface the settings through Nanocoder; or ask Nanocoder for a way to exempt sessions a client still references.

### 5. Recording the build decision

**Title:** Feedback for “Nanocoder Desktop”: Build decision note and repository creation are not recorded

**Source:** `OQ-20`, `OQ-21`

**Body:**

> **The problem.** How a project comes to life asks for a dated decision note with rationale on the whitepaper page, and a recorded reason when a review window is shortened. The page shows only the status change on 12 October, and the window that was due to close on 3 November closed that day. #115 also said the repository should not be created until the maintainer question is recorded; `Nano-Collective/nanocoder-desktop` was created on 22 October.
>
> **What to clarify.** The decision note, the reason for the shorter window, and confirmation that the existing repository is the one to build in.

## Docs repository: comments on existing issues

### On #116: transport for the desktop's MCP server

**Source:** `OQ-17`

> Once Nanocoder honours `mcpServers`, the desktop's browser server can reach Nanocoder over stdio (a helper process that connects back to the desktop), HTTP (a localhost port with a per-session secret header), or the unstable MCP-over-ACP transport in ACP SDK 1.4.0 (`type: "acp"`, `mcp/connect`, `mcp/message`). Nanocoder also loads MCP servers once per process today, so the change needs a per-session tool registry. Which transport should the Nanocoder change support first?

### On #117: runtime findings

**Source:** `OQ-22`

> Two findings for the bundling decision. Electron 45.0.0 embeds Node 24.22.0, which meets Nanocoder's `>=22`, so Electron's Node mode is viable, at the cost of keeping the `runAsNode` fuse on. A utility process cannot write to its child's stdin, so it cannot host an ACP server over stdio. The choice is Node mode or a Node 22 sidecar, to be measured on all three platforms.
>
> Also: published Nanocoder 1.31.0 (26 September) predates `session/close`, the trust check and per-session `cwd`, which are still pending changesets. The minimum supported version is the next Nanocoder release.

### On #118: Scriptura plugin compatibility

**Source:** `OQ-12`

> On plugin compatibility: Nanocoder Desktop has no plugin system of its own in v1, and Scriptura's AI layer is moving out of its plugin system. Suggested answer: not in v1. Shared ACP conformance tests in the Nanocoder repository are the compatibility point between the two apps.

## Nanocoder repository: new issues

### A. Read pre-edit snapshots over ACP

**Source:** `DEC-14`, [`git-review.md`](features/git-review.md#agent-changes-view)

> Add an extension method that returns the before-image of a path for a timeline checkpoint, so ACP clients can show only the agent's changes. Known limits to document: binary files are not snapshotted, 50 entries per session, timeline folders pruned after 7 days or beyond 20 sessions, and `timeline/list` needs the session loaded.

### B. Subagent events for ACP clients

**Source:** `OQ-03`, [`subagents.md`](features/subagents.md#proposed-projection) (or comment on nanocoder#1105)

> ACP clients see a subagent only as the `agent` tool card with a polled title. Ask for child run IDs, a parent link, per-child status and results, per-child cancel, and approval routing keyed by session (the docs note approvals can reach the wrong session today).

### C. Disable the built-in browser tool for one session

**Source:** `OQ-13`

> A client that provides its own browser needs a way to turn off the built-in `browser` tool for its sessions without editing the user's `disabledTools`.

### D. Extension method names and capability advertising

**Source:** quirk 20 in [`acp-integration.md`](acp-integration.md#known-nanocoder-acp-quirks)

> ACP reserves names starting with `_` for custom methods and recommends advertising extensions under `_meta` in capability objects. `renameSession`, `timeline/list`, `timeline/revert` and `retryTurn` use bare names and are not advertised. Ask for `_`-prefixed names (keeping the bare ones as aliases for a release) and a `_meta` entry in `agentCapabilities`.

### E. `session/load` with an unknown ID

**Source:** quirk 8 in [`acp-integration.md`](acp-integration.md#known-nanocoder-acp-quirks)

> `loadSession` with an unknown session ID creates an empty in-memory session and replays nothing, while `resumeSession` fails with "Session not found on disk". Ask whether load should fail the same way, so clients can detect a missing session.

### F. Retention for client-referenced sessions

**Source:** `OQ-16`

> Ask for a way for ACP clients to keep sessions they still reference out of retention, or to read the retention settings so they can warn users.

### G. Client-neutral replies to built-in slash commands

**Source:** quirk 18 in [`acp-integration.md`](acp-integration.md#known-nanocoder-acp-quirks)

> Over ACP, `/help` and the other built-in replies talk about "the VS Code GUI" and VS Code shortcuts. Ask for client-neutral wording, or a way for the client to name itself.

### H. Release timing

**Source:** [`acp-integration.md`](acp-integration.md#supported-nanocoder-versions)

> The desktop's technical gate needs `session/close`, the ACP trust check and per-session `cwd`, which are merged but unreleased. Ask when the next release is planned.
