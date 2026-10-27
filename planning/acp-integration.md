# ACP integration

How the desktop drives `nanocoder --acp`: methods, capability negotiation, supported versions, known Nanocoder quirks, and the Nanocoder changes the plan depends on.

- Status: Draft
- Last updated: 2026-10-27
- Drafted by: @akramcodez

## Baseline

Every Nanocoder fact in this file was read in source at commit [`8a5f4d4`][nc-tree] (Nanocoder 1.31.0, local `main` on 2026-10-23). The whitepaper's research and [#122][pr122] used [`dc8e121`][nc-tree-dc] (Nanocoder 1.30.0). Upstream `main` was three commits ahead of `8a5f4d4` when this was written: [`6dac501`][nc-6dac501] (failed tool calls reported as `failed`), [`5eabeef`][nc-5eabeef] (invalid UTF-8 bytes replaced in `acp-agent.ts`) and a badge update. Line numbers in links refer to `8a5f4d4`.

Nanocoder declares `@agentclientprotocol/sdk` `^1.3.0` and its lockfile resolves 1.4.0 ([`package.json`][nc-pkg]). The SDK is licensed Apache-2.0 and ships as ESM. The desktop uses the client side of the same SDK.

## Requirements

| ID | Requirement | Status and source |
|---|---|---|
| ACP-01 | Launch Nanocoder only from a trusted absolute runtime and entry point, with an argument array (`--acp` plus explicit flags), no shell, and the working directory set to the canonical project root. Show the resolved path and version to the user. | Decided ([whitepaper, Distribution][wp-dist]) |
| ACP-02 | Send `initialize` with the client's protocol version and capabilities: `fs.readTextFile: true`, `fs.writeTextFile: false`, no terminal. Record `protocolVersion`, `agentCapabilities` and `agentInfo.version`. | Decided ([whitepaper, Why ACP][wp-why]) |
| ACP-03 | Gate every feature on what the connected Nanocoder offers (capability, version and, for extension methods, a probe). A missing feature is turned off with a visible reason, never silently degraded into a privileged fallback. | Decided ([whitepaper][wp-why]); probe method Proposed ([#117][i117]) |
| ACP-04 | Enforce the supported version policy: refuse versions below the minimum, warn on versions newer than the tested range, always allow the bundled version. | Proposed (awaiting @will-lamerton) ([#117][i117]) |
| ACP-05 | Create sessions with `session/new`, passing the session `cwd` and (when supported) the desktop's `mcpServers`. Store the returned session ID before rendering anything. | Decided ([whitepaper, Durable chats][wp-durable]) |
| ACP-06 | Continue threads with `session/resume`, which fails when the session is missing. Do not use `session/load` to test whether a session exists. | Suggestion (not discussed), based on [source][nc-load] |
| ACP-07 | Rebuild a resumed thread only from replayed `session/update` notifications. Treat replayed tool calls as completed history, not new activity. | Decided ([whitepaper, Resume sequence][wp-resume]) |
| ACP-08 | Send `session/close` when a thread is closed or before idle shutdown, only when `sessionCapabilities.close` is advertised. | Decided ([nanocoder#1709][nc1709]) |
| ACP-09 | Send `session/cancel` when the user interrupts a turn, and answer any pending permission request as cancelled. | Decided ([whitepaper, Process policy][wp-process]) |
| ACP-10 | Route every `session/request_permission` to its thread, show Nanocoder's own options unchanged, and reply only with the option the user chose. The desktop never answers on the user's behalf. | Decided ([whitepaper][wp-threat]); "never on the user's behalf" Proposed ([#108][i108]) |
| ACP-11 | Answer `fs/read_text_file` only for paths inside the canonical project root, within size limits, through the same checks as the file browser. Offer no write and no terminal capability. | Decided ([whitepaper, Why ACP][wp-why]) |
| ACP-12 | Parse Nanocoder's vendor data defensively: `_nanocoder/sessionTitleChanged` notifications and `_meta` keys (`nanocoder/usage`, `nanocoder/artifacts`, `nanocoder/response-usage`, `nanocoder/durationMs`, `nanocoder/outcome`). Unknown keys are ignored, malformed ones are logged and dropped. | Decided that they exist ([#122][pr122]); handling is Suggestion (not discussed) |
| ACP-13 | Set the session mode with `session/set_mode` after every `session/new` and `session/resume`, including after a restart, and only between turns. Check the mode against the session's `availableModes` first; the thread takes no prompt until it succeeds. See [Session mode](#session-mode). | Proposed (awaiting @will-lamerton) (`DEC-31`, [#5][i5]) |
| ACP-14 | Treat model and provider selection as process-global. Allow a change only when no turn is running in the project's process, and say that it applies to every thread in the project. | Decided that it is process-global ([whitepaper, Open risks][wp-risks]); the guard is Suggestion (not discussed) |
| ACP-15 | Treat stdout as protocol only. A frame that does not parse ends the connection and fails the process. | Decided ([whitepaper, Architecture][wp-arch]) |
| ACP-16 | Keep stderr in a bounded, redacted, in-memory ring that is never persisted and leaves the machine only after the user reviews it. | Decided ([whitepaper][wp-arch]) |
| ACP-17 | Supervise the process: detect exit, keep the exit code and signal, mark running threads Failed, restart with limited backoff, resume the open thread. Never restart automatically when the process exits before `initialize` returns, as it does on a trust refusal. | Decided ([whitepaper, Process policy][wp-process]); backoff policy Suggestion (not discussed); no restart before `initialize` Proposed (awaiting @will-lamerton) (`DEC-30`) |
| ACP-18 | Discover sessions with `session/list` on a best-effort basis. The stored Nanocoder session ID is the durable join key; listing never decides whether a known thread exists. | Decided ([whitepaper, Project and session identity][wp-identity]) |
| ACP-19 | When `session/resume` reports a missing session, move the thread to ViewOnly and explain the likely cause (deleted, or removed by Nanocoder's retention settings). | Decided (ViewOnly state); the explanation is Suggestion (not discussed) |
| ACP-20 | Never start a session in a project the user has not trusted. The one exception is a pre-trust probe: until Nanocoder can report trust without starting ACP ([nanocoder#1899][nc1899]), the desktop starts `nanocoder --acp` once to learn the verdict, and it exits on a refusal before opening any session. After the user confirms, record trust in Nanocoder's own store with one short trust launch; no other launch sets a trust override. If Nanocoder refuses at startup, show its reason and the trust prompt again. See [Directory trust](#directory-trust). | Proposed (awaiting @will-lamerton) (`DEC-30`, [#4][i4]) |
| ACP-21 | Run the shared ACP conformance tests against every Nanocoder version the desktop supports. | Proposed (awaiting @will-lamerton) ([#118][i118]) |
| ACP-22 | Pass the desktop's browser-control MCP server in `mcpServers` on `session/new` and `session/resume` once Nanocoder honours it, and advertise agent browser control only when that server and the browser view are both ready. | Proposed (awaiting @will-lamerton) ([#116][i116]); transport Open (`OQ-17`) |
| ACP-23 | Shut the project process down after an idle period, closing open sessions first, and resume on next use. | Decided in principle ([whitepaper, Process policy][wp-process]); the period is Suggestion (not discussed) |

## ACP methods used

Method names are the wire names from the SDK's method tables. "Status at `8a5f4d4`" is what Nanocoder does at that commit.

### Client to agent

| Method | Desktop use | Status at `8a5f4d4` |
|---|---|---|
| `initialize` | Version and capability negotiation (`ACP-02`). | Handled. Returns the negotiated protocol version, `loadSession: true`, `sessionCapabilities` `close`, `list`, `delete`, `resume`, an empty `providers` object, `agentInfo` and `authMethods: []` ([source][nc-init], [capabilities][nc-caps]). |
| `session/new` | Start a thread (`ACP-05`). | Handled. Ignores `mcpServers` ([source][nc-new]). Starts the session in `auto-accept` ([source][nc-register]). |
| `session/resume` | Continue a thread (`ACP-06`). | Handled. Throws `Session not found on disk` for a missing session. Uses the persisted working directory, not the one the client sends, and ignores `mcpServers` ([source][nc-resume]). |
| `session/load` | Not used for continuation. | Handled, but creates an empty session when the ID is unknown ([source][nc-load]). |
| `session/list` | Discovery (`ACP-18`). | Handled. Filters by exact `path.normalize` equality on `cwd` ([source][nc-list], [session manager][nc-sm-list]). |
| `session/close` | Close a thread, idle shutdown (`ACP-08`). | Handled since [nanocoder#1709][nc1709] (merged 2026-10-19). Cancels in-flight work, drops the in-memory session, keeps the file on disk ([source][nc-close]). |
| `session/delete` | Delete a thread's Nanocoder session, only on explicit user request (`CHAT-14`). | Handled. Clears the session's timeline and deletes the session ([source][nc-delete]). |
| `session/prompt` | Send a turn. | Handled. A second prompt in the same session waits for the first (FIFO), it is not rejected ([source][nc-queue]). |
| `session/cancel` | Interrupt (`ACP-09`). | Handled ([source][nc-cancel]). |
| `session/set_mode` | Choose `normal`, `auto-accept`, `yolo`, `plan` or `architect` (`ACP-13`). | Handled ([source][nc-set-mode]). A change sent during a turn is not applied to that turn ([nanocoder#1857][nc1857], open). |
| `session/set_config_option` | Model and provider selection (`ACP-14`). | Handled for `model` and `provider`. Both change the shared client for every session in the process ([source][nc-config]). |
| `authenticate` | Not used. | Returns an empty result; Nanocoder advertises no auth methods. |

### Agent to client

| Method | Desktop handling | Status at `8a5f4d4` |
|---|---|---|
| `session/update` | Stream rendering (`CHAT-05`): `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `available_commands_update`, and any other update type the SDK defines. | Sent. Replay sends past tool calls with `status: completed` ([source][nc-replay]). |
| `session/request_permission` | Permission cards (`ACP-10`). | Sent for protected tools, and for subagent tools with `subagent:`-prefixed IDs ([source][nc-subagent-approval]). |
| `fs/read_text_file` | Root-checked reads (`ACP-11`). | Used for `@`-mentioned resources when the client advertises the capability ([source][nc-prompt-read]). |
| `fs/write_text_file`, `terminal/*` | Not offered. | Not used by the desktop by design. |
| `_nanocoder/sessionTitleChanged` (notification) | Update the thread title (`CHAT-12`). | Sent after a successful turn when a title is generated ([source][nc-title]). |

### Nanocoder extension methods

Nanocoder answers four extension requests ([source][nc-ext]). On the wire they use bare names: Nanocoder's own VS Code client calls `extMethod('renameSession', ...)` ([source][nc-vscode-rename]), and SDK 1.4.0 passes unknown request methods to `extMethod` unchanged. That breaks ACP's rule that custom method names start with an underscore, and the spec says extensions should be advertised under `_meta` in capability objects ([ACP extensibility][acp-ext]). If Nanocoder fixes this the names will change, so the desktop calls them through one adapter that tries the `_`-prefixed name first and the bare name second.

| Method | Desktop use | Notes |
|---|---|---|
| `renameSession` | User renames a thread (`CHAT-12`). | Works on the session file, so the session does not need to be loaded. |
| `timeline/list` | Touched files and the #109 baseline (`GIT-05`, `GIT-09`). | Requires the session to be loaded in this process. |
| `timeline/revert` | Not in v1. | Destructive: rewrites files and truncates history. Out of scope with read-only review (`DEC-22`). |
| `retryTurn` | Not in v1. | Truncates history. A later feature. |

None of these is declared in `initialize`, so the desktop detects them by version and by a safe probe (`ACP-03`).

## Capability negotiation at startup

1. **Launch** (`ACP-01`). If the process exits before `initialize` returns, read the stderr ring. Nanocoder writes its trust refusal and initialisation failures there ([source][nc-server]).
2. **Initialise** (`ACP-02`). Check the negotiated protocol version equals the one the desktop supports (protocol version 1 in SDK 1.4.0).
3. **Check the version** (`ACP-04`) against the supported range.
4. **Build feature gates.**

   | Desktop feature | Gate |
   |---|---|
   | Durable resume | `sessionCapabilities.resume` advertised. Without it, threads open view-only after a restart. |
   | Close on idle | `sessionCapabilities.close` advertised. Without it, idle shutdown just ends the process. |
   | Thread deletion | `sessionCapabilities.delete` advertised. |
   | Session discovery | `sessionCapabilities.list` advertised. |
   | Rename | Version at or above the first version known to answer `renameSession`, or a probe that returns anything other than "unknown method". |
   | Touched files from the timeline | Same rule for `timeline/list`. Otherwise fall back to tool call locations. |
   | Agent changes view | A snapshot-read method that does not exist yet (`DEC-14`). Off until it does. |
   | Agent browser control | Nanocoder honours `mcpServers` (a version gate once [#116][i116] lands) and the broker and browser view are ready. Off otherwise. |
   | Subagent run tree | A child-event projection that does not exist yet (`OQ-03`). Otherwise subagents show as tool cards. |

5. **Report.** The thread list shows which features are on and why any are off (`CHAT-15`).

Suggestion (not discussed): record the gate results per tested Nanocoder version in a small fixture file, so a contributor can see what changed when the bundled version moves.

## Supported Nanocoder versions

Proposed (awaiting @will-lamerton), from [#117][i117-c]:

- **Prototype.** Uses the Nanocoder the user installed. The desktop resolves it to an absolute path once, shows the path and version, and asks before using a different one (`REL-01`).
- **First public release.** Bundles a pinned, tested Nanocoder (`REL-02`). That version is the one the project supports.
- **Override.** Advanced users and contributors can point the desktop at another Nanocoder. Any version at or above a minimum works, with features gated as above (`REL-03`).

Open:

- **The minimum version.** No published Nanocoder has `session/close` yet. Version 1.31.0 was published to npm on 2026-09-26 ([npm][npm-nc]), before [nanocoder#1709][nc1709] merged on 2026-10-19, and at `8a5f4d4` the fix is still a pending changeset ([changeset][nc-cs-close]). The directory trust check, per-session `cwd` and the built-in `browser` tool are in the same position ([changesets][nc-cs-dir]). The minimum supported version is therefore the next Nanocoder release, and the technical gate runs against a build of Nanocoder `main` until that release exists.
- **Runtime.** Nanocoder requires Node 22 or newer ([source][nc-engines]). Electron 45.0.0 embeds Node 24.22.0 ([Electron releases][el-releases]), so Electron's Node mode meets the requirement. What remains of the runtime question is `OQ-22`.

## Known Nanocoder ACP quirks

The six findings from [#122][pr122], checked at both commits, then the quirks this plan found.

| # | Quirk | At `dc8e121` | At `8a5f4d4` | Desktop handling |
|---|---|---|---|---|
| 1 | `session/close` advertised but not handled | True | Fixed by [nanocoder#1709][nc1709] ([source][nc-close]) | Gate on version (`ACP-08`). |
| 2 | Extension methods not declared as capabilities | True | Still true ([source][nc-caps]) | Version checks plus probes (`ACP-03`). |
| 3 | Titles, usage and artefacts in vendor fields | True | Still true, with more `_meta` keys on replay ([source][nc-replay-meta]) | Defensive parsing (`ACP-12`). |
| 4 | History survives a restart | True | True, subject to retention (row 10) | `session/resume` (`ACP-06`). |
| 5 | Session listing matches exact paths only | True | Still true ([source][nc-sm-list]) | Client-side matching (see [Session discovery](#session-discovery-and-identity)). |
| 6 | Model selection is process-global | True | Still true, and provider selection too ([source][nc-config]) | `ACP-14`, `CHAT-17`. |
| 7 | A second prompt in the same session | Rejected with "Prompt already in progress" | Queued behind the first ([source][nc-queue]) | The desktop prevents overlap itself (`CHAT-17`). |
| 8 | `session/load` with an unknown ID | Creates an empty session | Same ([source][nc-load]) | Use `session/resume` (`ACP-06`). |
| 9 | Initial mode | `auto-accept` | `auto-accept` ([source][nc-register], [docs][nc-acp-modes]) | Set the mode explicitly (`ACP-13`, `DEC-31`). |
| 10 | Session retention | Not checked | Sessions idle for 30 days, and the oldest beyond 100, are deleted by default ([source][nc-retention]) | ViewOnly with an explanation (`ACP-19`, `OQ-16`). |
| 11 | `session/resume` working directory | Not checked | Uses the persisted directory and ignores the client's ([source][nc-resume]) | Store both canonical root and session cwd (`DATA-02`). |
| 12 | Resume does not restore the session's model | Not checked | The resumed session uses the process's current model ([source][nc-resume]) | Show the current model on resume; do not imply the old one is active. |
| 13 | Directory trust at startup | No check | `--acp` exits if the spawn directory is untrusted ([nanocoder#1847][nc1847]) | `ACP-20`, `DEC-30` ([Directory trust](#directory-trust)). |
| 14 | Project configuration scope | Not checked | Read once from the spawn directory; plugins load per session ([docs][nc-acp-req]) | One process per project, spawned at the root. |
| 15 | Subagent approvals | Not checked | Always ask regardless of mode, are marked completed on approval before running, and share one handler per process ([docs][nc-acp-limits], [source][nc-global-handler]) | See [`subagents.md`](features/subagents.md). |
| 16 | Failed tool status | Not checked | Only output starting with `Error` is reported as failed; fixed upstream after `8a5f4d4` in [`6dac501`][nc-6dac501] | Require a version with the fix for accurate status. |
| 17 | Built-in `browser` tool | Not present | Present ([nanocoder#1626][nc1626]) | `OQ-13`. |
| 18 | Built-in slash command replies | Not checked | `/help` and other replies are written for the VS Code sidebar ([source][nc-slash]) | Do not surface Nanocoder's `/help` text as desktop help. Suggestion (not discussed): ask Nanocoder for client-neutral wording. |
| 19 | `timeline/list` scope | Not checked | Requires the session to be loaded in memory ([source][nc-ext]) | Call it only after `session/resume`. |
| 20 | Extension method names | Bare names | Still bare (`renameSession`, `timeline/list`), against ACP's rule that custom methods start with `_` ([ACP extensibility][acp-ext]) | One adapter that tries both forms. |
| 21 | Published versus `main` | 1.30.0 published | Published 1.31.0 predates rows 1, 13, 17 and per-session `cwd`; they are pending changesets ([changesets][nc-cs-dir]) | Run the gate against `main` until the next release. |
| 22 | Trust refusal exit code | No check | Exits with code 1, the same as any other startup failure ([source][nc-acp-exit]) | Match the message text until a refusal has its own code (`DEC-30`). |
| 23 | Trust matching | No check | Exact resolved path, no symlink or case folding, plus an unversioned fingerprint ([source][nc-trust-match]). `main` adds a project `.env`, confirmation-relaxing settings and provider `baseUrl`s to the fingerprint ([`69b4891`][nc-69b4891]) | Launch at the canonical root; expect a re-prompt when the Nanocoder version changes (`DEC-30`). |
| 24 | Plugin trust per session | Not checked | Checked against the session's own working directory, not the spawn root ([source][nc-plugin-trust]) | Sessions at the project root in v1 (`DEC-30`). |
| 25 | Environment inheritance | Not checked | Hooks and the bash tool inherit Nanocoder's whole environment ([hooks][nc-hook-env], [bash][nc-bash-env]) | `NANOCODER_TRUST_DIRECTORY` only on the trust launch (`DEC-30`). |
| 26 | Unknown mode IDs | Not checked | Fall back to `auto-accept` ([source][nc-mode-map]) | Check against `availableModes` before sending (`DEC-31`). |
| 27 | Mode read-back | Not checked | `session/set_mode` returns `{}` and sends no update ([source][nc-set-mode]); `currentModeId` in the session response stays `auto-accept` ([source][nc-register]) | Check the mode by behaviour, not by what is reported (`DEC-31`). |
| 28 | `--mode` with `--acp` | Not checked | Parsed but not passed to the ACP server ([source][nc-cli-mode]) | Ask Nanocoder to pass it through, so a missed `set_mode` fails closed (`DEC-31`). |
| 29 | `alwaysAllow` and modes | Not checked | Checked before the mode, so listed tools never ask, even in `normal` ([source][nc-approval]) | Say so in the UI (`DEC-31`). |
| 30 | Permission options | Not checked | Always `Allow` (`allow_once`) and `Deny` (`reject_once`); there is no "always" option ([source][nc-permission]) | Show the options as sent (`ACP-10`). |
| 31 | Answering a request | Not checked | A rejected tool is marked `failed` and the model is told "Tool call denied by user"; the turn goes on. A `cancelled` answer ends the turn with `cancelled` ([source][nc-permission]) | The desktop reports the stop reason as Nanocoder gives it (`G.4`). |

## Directory trust

Proposed (awaiting @will-lamerton) (`DEC-30`), agreed in [#4][i4] ([pick][i4-pick], [review][i4-review]). Nanocoder owns the trust store. The desktop asks, records trust through Nanocoder, and never writes Nanocoder's files.

Since [nanocoder#1847][nc1847], `nanocoder --acp` exits when its working directory is not trusted ([source][nc-server]). Nanocoder trusts a folder by its resolved path and a fingerprint of what the folder will run ([source][nc-trust-match]), so a later change to that is asked about again.

| Step | Behaviour | Why |
|---|---|---|
| Before trust | File tree only. No session, no Git, no watchers that follow config (`SEC-17`). One pre-trust probe starts `nanocoder --acp` to learn the verdict; see the known gaps below. | Nanocoder config and Git config (`core.fsmonitor`) can run code. Nanocoder has no way yet to report trust without starting. |
| Prompt | Lists what will run, read as files without running anything: plugins, hooks, MCP servers, formatters, LSP servers, custom tools, subscribed skills, agents and commands, a project `.env`, the settings that relax confirmations (`alwaysAllow`, `defaultMode`, `sandbox`, `verify.trustLevel`) and provider `baseUrl`s. | The inputs Nanocoder fingerprints on `main` ([`69b4891`][nc-69b4891]). Replaced by Nanocoder's own summary once it can print one ([Nanocoder changes needed](#nanocoder-changes-needed)). |
| Trust launch | After the user confirms, start `nanocoder --acp` once with `NANOCODER_TRUST_DIRECTORY=1` and stdin closed, wait for it to exit, then launch normally. | Nanocoder saves the folder and its fingerprint in its own store. `--trust-directory` is not used: it lasts one run, so per-session plugins never load and config changes are never checked again. |
| Every other launch | No `NANOCODER_TRUST_DIRECTORY` and no `--trust-directory`. An inherited `NANOCODER_TRUST_DIRECTORY` is dropped (`SEC-05`, done in phase G.2). | Hooks and the bash tool inherit Nanocoder's environment ([hooks][nc-hook-env], [bash][nc-bash-env]). With the variable set, a `nanocoder` the agent runs would trust its own folder without asking, and Nanocoder would re-trust a changed config silently. |
| Later refusal | Nanocoder writes that the directory `is not trusted`, has `changed since you trusted it` or `needs re-approval after the upgrade`, then exits. The desktop shows that reason and the prompt again, and never restarts automatically (`ACP-17`). | The fingerprint catches new hooks or MCP servers, for example after a `git pull`. A refusal and other startup failures share exit code 1 ([source][nc-acp-exit]), so the desktop matches the message text until Nanocoder gives a refusal its own code. |
| Paths | Launch at the canonical project root (`SEC-03`). | Nanocoder matches the exact resolved path ([source][nc-trust-match]), and on Windows compares it case-sensitively ([nanocoder#1689][nc1689]). A trust the CLI saved under another spelling of the path costs one extra prompt. |
| Sessions | In v1, every session's working directory is the project root. | Nanocoder checks plugin trust against the session's own working directory ([source][nc-plugin-trust]), so a session in a subfolder would run without plugins. |
| Scope | Nanocoder's store is shared with the Nanocoder CLI on this machine. The desktop's own `trusted` flag (`DATA-02`) gates Git and watchers. One prompt sets both. | One trust store for Nanocoder, owned by Nanocoder. |

Known gaps until the Nanocoder changes land:

- The trust launch saves the fingerprint the folder has at launch, not the one the user was shown. Nanocoder's own prompt passes the fingerprint it showed ([source][nc-grant]); the variable cannot.
- The trust launch loads the project config and starts its MCP servers once, with the variable set, before it sees stdin close.
- Trust entries carry no fingerprint version, and the inputs change between Nanocoder versions. A CLI and a bundled Nanocoder on different versions each see the other's entry as changed, so the user is asked again after each switch.
- The desktop's prompt list can drift from what Nanocoder fingerprints.
- The pre-trust probe: to learn the trust verdict, the desktop starts `nanocoder --acp`. Its imports load the project `.env` into its environment before the trust check, except protected keys such as `NANOCODER_TRUST_DIRECTORY` ([source](https://github.com/Nano-Collective/nanocoder/blob/f5d82179f5032dc4990916e22a72d02f0feb2343/source/config/index.ts#L58)); on a refusal it exits without running anything. The status command in [nanocoder#1899][nc1899] would avoid this launch.

To check: in phase G.3, a changed fingerprint makes `--acp` exit with a reason the desktop can show; in G.4, which runs real turns, plugins load for a session at the project root.

## Session mode

Proposed (awaiting @will-lamerton) (`DEC-31`), agreed in [#5][i5] ([pick][i5-pick], [review][i5-review], [follow-up][i5-follow]).

Nanocoder registers every new, loaded and resumed ACP session in `auto-accept` and does not save the mode ([source][nc-register]). The desktop sets the mode on every session.

| Rule | Behaviour | Why |
|---|---|---|
| Starting mode | `normal`. | `SP-04` needs approvals, the browser boundary allows public-site control only in `normal` (`BRW-16`), and `normal` is Nanocoder's own interactive default. |
| Project default | Each project has a default mode: `normal`, until the user picks "Use as this project's default" for another mode. `yolo` is never a default. | A one-off switch, for example to `auto-accept` for a quick task, does not carry over to the next thread unnoticed. |
| Thread mode | A new thread takes the project default. A resumed thread keeps its own mode, except `yolo`, which falls back to the project default. | Nanocoder keeps the mode per session, unlike the model, which is process-wide (`ACP-14`). |
| Sending it | After every `session/new` and `session/resume`, including after an idle or crash restart, check the mode against the session's `availableModes`, then send `session/set_mode`. The thread takes no prompt until it succeeds. | An unknown mode ID falls back to `auto-accept` ([source][nc-mode-map]), and nothing reports the applied mode ([source][nc-set-mode]). |
| `yolo` | Needs a confirmation each time, lasts for that thread only, and is never restored on resume. | It skips every approval. |
| During a turn | The mode control is disabled, with a hint to stop the turn first. | Nanocoder does not apply a change to the running turn ([nanocoder#1857][nc1857]). |
| Public browsing | Paused outside `normal`, with the reason shown (`BRW-16`). | Keeps the [#108][i108] boundary. |
| Limits of `normal` | The mode control says that tools in Nanocoder's `alwaysAllow` run without asking in every mode. The trust prompt calls out a project-level `alwaysAllow` or `defaultMode` (`DEC-30`). | Nanocoder checks `alwaysAllow` before the mode ([source][nc-approval]). |

To check by behaviour, since Nanocoder does not report the applied mode: in G.4, a protected tool call in a new session produces a permission request; in G.5, so does one in a resumed session. G.3 checks the plumbing: no prompt before `set_mode` succeeds, and no mode outside `availableModes` is sent.

## Session discovery and identity

Decided ([whitepaper, Project and session identity][wp-identity]):

- The desktop stores both the **canonical project root** (used for security checks) and the **session cwd** (the directory passed to ACP).
- The **Nanocoder session ID** is the durable join key. Listing is discovery only.

How discovery should work, Suggestion (not discussed):

1. Call `session/list` without a `cwd` filter. Nanocoder then returns every saved session ([source][nc-sm-list]).
2. Canonicalise each session's `cwd` the same way the desktop canonicalises project roots: resolve symlinks, and compare case-insensitively on case-insensitive filesystems.
3. Treat a session as belonging to the project when its canonical `cwd` is the root or inside it.
4. Offer unknown matching sessions for import into the thread list. Do not store sessions that do not belong to a known project.
5. Never persist titles of sessions from other projects: they can contain sensitive text.

This avoids depending on Nanocoder changing its exact-match filter. A Nanocoder change is still useful for other clients.

## Process-global model state

At `8a5f4d4`, `setSessionConfigOption` changes the model (or provider) on the one LLM client shared by every session in the process, and the code says so ([source][nc-config]). Consequences for the desktop:

- A model change in one thread changes the model for every thread in that project.
- A resumed thread runs on the process's current model, not the one it last used.
- Two threads mid-turn at once would share the same client, the same tool approval handler and the same subagent approval routing. This is why one root turn at a time is a hard rule (`CHAT-17`).

The UI says what is true: the model control belongs to the project, not the thread (`CHAT-10`).

## Nanocoder changes needed

| What | Why | Issue or PR | Owner | Needed by | Status |
|---|---|---|---|---|---|
| Honour client `mcpServers` on `session/new`, `session/load` and `session/resume`, with a per-session tool registry | The browser-control tool must exist only in desktop sessions (`ACP-22`, `BRW-11`). MCP servers are loaded once per process today ([source][nc-mcp-init]). | [#116][i116], [nanocoder#1889][nc1889] | @puri-adityakumar (offered on #116) | Before Milestone 3 | Proposed (awaiting @will-lamerton) |
| Implement `session/close` | Advertised but unhandled. | [nanocoder#1709][nc1709] | @will-lamerton | Technical gate | Decided (merged 2026-10-19) |
| Read pre-edit snapshots over ACP (for example a `timeline/read` method returning the before-image for a checkpoint and path) | The "Agent changes" view (`GIT-09`). | [#109][i109] | Open (approach proposed by @puri-adityakumar) | Milestone 2 if `DEC-14` is accepted for v1, otherwise Later | Proposed (awaiting @will-lamerton) |
| Subagent event projection: child run IDs, parent link, status, real tool results, per-child cancel, and approval routing keyed by session | `SP-05` asks to observe and stop a child run (`SUB-05` to `SUB-08`). Today subagents appear only as a polled tool card title ([source][nc-agent-poll]). | [nanocoder#1105][nc1105] (results), new issue for the rest | Open | Milestone 1 for the full `SP-05`; v1 can ship the fallback | Open (`OQ-03`) |
| Apply `session/set_mode` to a running turn, or reject it | `DEC-15` relies on mode to gate public-site control. | [nanocoder#1857][nc1857] | Open | Milestone 3 | Open |
| A way to disable the built-in `browser` tool for one session or process without editing user config | Keeps one browser in desktop sessions. | New issue needed | Open | Milestone 3 | Open (`OQ-13`) |
| Prefix extension methods with `_` and advertise them under `_meta` in `agentCapabilities` | ACP requires the prefix and recommends advertising extensions ([ACP extensibility][acp-ext]); removes version guessing for `renameSession` and `timeline/*`. | Finding 2 in [#122][pr122] | Open | Nice to have | Open |
| Exempt client-referenced sessions from retention, or expose retention settings over ACP | Durable threads (`SP-06`). | New issue needed | Open | Milestone 4 | Open (`OQ-16`) |
| Report failed tool calls by `isError` | Accurate tool status in the chat. | [`6dac501`][nc-6dac501] | @addyCooks | Technical gate | Decided (on upstream `main`) |
| A read-only trust status command: summary, fingerprint and status (trusted, not trusted, changed, needs re-approval) as JSON, without loading project config | The prompt shows exactly what Nanocoder fingerprints, and the desktop can check before launching (`DEC-30`). | [nanocoder#1899][nc1899] | Open | Milestone 1 (phase 1.2) | Open (raised in [#4 review][i4-review]) |
| Save trust for a given fingerprint, refusing if the folder has changed since | Ties consent to what the user saw and replaces the `NANOCODER_TRUST_DIRECTORY` trust launch (`DEC-30`). | [nanocoder#1899][nc1899] | Open | Milestone 1 (phase 1.2) | Open |
| A distinct exit code for a trust refusal | A refusal and other startup failures share exit code 1 ([source][nc-acp-exit]). | [nanocoder#1899][nc1899] | Open | Nice to have | Open (raised in [#4 review][i4-review]) |
| Version the trust fingerprint and treat an older version as "needs re-approval" | Stops the CLI and a bundled Nanocoder on different versions from re-asking each other. | [nanocoder#1899][nc1899] | Open | Before the bundled release (`REL-02`) | Open (raised in [#4 review][i4-review]) |
| Pass `--mode` through to the ACP server, as the starting mode of every new, loaded and resumed session | A missed `set_mode` would then fail closed (`DEC-31`). | [nanocoder#1900][nc1900], tracked in [#12][i12] | Open | Milestone 1 | Open (raised in [#5 review][i5-review]) |
| Reject an unknown mode ID instead of falling back to `auto-accept` | A wrong or renamed mode ID would otherwise turn approvals off (`DEC-31`). | [nanocoder#1900][nc1900], tracked in [#12][i12] | Open | Milestone 1 | Open (raised in [#5 follow-up][i5-follow]) |
| Report the applied mode, in the `session/set_mode` response or a mode-update notification | The desktop cannot confirm the mode today (`DEC-31`). | [nanocoder#1900][nc1900], tracked in [#12][i12] | Open | Nice to have | Open |
| Expose the effective approval policy, including `alwaysAllow` | `normal` does not ask for tools in `alwaysAllow`, which weakens `BRW-16` (`DEC-31`). | Not raised yet, tracked in [#12][i12] | Open | Milestone 3 | Open (raised in [#5 review][i5-review]) |
| Isolate model state per session | Parallel root turns. | Whitepaper risk | Open | Later | Open |

## Shared ACP conformance tests

Proposed (awaiting @will-lamerton) on [#118][i118-c]: ACP tests shared by Nanocoder Desktop and Scriptura live in the Nanocoder repository, and Nanocoder bugs are fixed there once.

What the suite should prove, Suggestion (not discussed):

- `initialize` advertises exactly the methods the agent handles. The `session/close` bug would have failed this check.
- `session/resume` after a full process restart replays the same history.
- `session/resume` for an unknown ID fails.
- `session/close` keeps the session resumable.
- Cancelling during a permission request ends the turn with `cancelled`.
- Permission options are stable across versions.
- With [#116][i116]: a client-provided MCP server is visible only in the session that passed it.

Nanocoder already has unit-level ACP specs (`acp-agent.spec.ts`, `acp-capabilities.spec.ts`, `conversation.contract.spec.ts`) that drive the agent in process. A conformance suite would instead spawn the built `nanocoder --acp` with a scripted provider, so every client tests the same thing a user runs. Owner: Open.

[nc-tree]: https://github.com/Nano-Collective/nanocoder/tree/8a5f4d46317d93128c531f39b80b5ac6fd2da25b
[nc-tree-dc]: https://github.com/Nano-Collective/nanocoder/tree/dc8e121a0c4e6963df7447b9ae68491ec993679b
[nc-6dac501]: https://github.com/Nano-Collective/nanocoder/commit/6dac501756b8f17f7f83a66fdc91dfe16fd66f4a
[nc-5eabeef]: https://github.com/Nano-Collective/nanocoder/commit/5eabeef74e196e7871e709b296aae3c4679ca059
[nc-pkg]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/package.json#L76-L77
[nc-engines]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/package.json#L32-L34
[nc-init]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L116-L134
[nc-caps]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-capabilities.ts#L25-L36
[nc-new]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L136-L165
[nc-load]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L167-L196
[nc-prompt-read]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L231-L243
[nc-queue]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L204-L222
[nc-slash]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L252-L371
[nc-title]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L482-L500
[nc-cancel]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L505-L511
[nc-close]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L513-L529
[nc-set-mode]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L531-L548
[nc-config]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L550-L622
[nc-list]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L624-L640
[nc-delete]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L642-L664
[nc-resume]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L666-L697
[nc-ext]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L704-L822
[nc-register]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L862-L873
[nc-replay]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L882-L954
[nc-replay-meta]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L932-L951
[nc-server]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-server.ts#L24-L50
[nc-sm-list]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/session/session-manager.ts#L390-L401
[nc-retention]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/session/session-manager.ts#L521-L607
[nc-subagent-approval]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-conversation.ts#L90-L160
[nc-global-handler]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-conversation.ts#L163-L193
[nc-agent-poll]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-conversation.ts#L660-L705
[nc-mcp-init]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/plain/initialize.ts#L183-L196
[nc-acp-modes]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L33
[nc-acp-req]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L77-L82
[nc-acp-limits]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L84-L88
[nc-vscode-rename]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/plugins/vscode/src/acp-client.ts#L491-L497
[nc1105]: https://github.com/Nano-Collective/nanocoder/issues/1105
[nc1626]: https://github.com/Nano-Collective/nanocoder/pull/1626
[nc1709]: https://github.com/Nano-Collective/nanocoder/pull/1709
[nc1847]: https://github.com/Nano-Collective/nanocoder/pull/1847
[nc1857]: https://github.com/Nano-Collective/nanocoder/issues/1857
[pr122]: https://github.com/Nano-Collective/docs/pull/122
[i108]: https://github.com/Nano-Collective/docs/issues/108
[i109]: https://github.com/Nano-Collective/docs/issues/109
[i116]: https://github.com/Nano-Collective/docs/issues/116
[i117]: https://github.com/Nano-Collective/docs/issues/117
[i117-c]: https://github.com/Nano-Collective/docs/issues/117#issuecomment-6208555047
[i118]: https://github.com/Nano-Collective/docs/issues/118
[i118-c]: https://github.com/Nano-Collective/docs/issues/118#issuecomment-6210219535
[wp-arch]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L189-L246
[wp-why]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L267-L275
[wp-process]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L277-L284
[wp-durable]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L286-L355
[wp-resume]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L357-L387
[wp-identity]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L389-L398
[wp-dist]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L564-L583
[wp-threat]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L585-L633
[wp-risks]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L635-L648
[acp-ext]: https://agentclientprotocol.com/protocol/extensibility
[npm-nc]: https://www.npmjs.com/package/@nanocollective/nanocoder
[nc-cs-close]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/.changeset/acp-close-session.md
[nc-cs-dir]: https://github.com/Nano-Collective/nanocoder/tree/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/.changeset
[el-releases]: https://releases.electronjs.org/release/v45.0.0
[i4]: https://github.com/Nano-Collective/nanocoder-desktop/issues/4
[i4-pick]: https://github.com/Nano-Collective/nanocoder-desktop/issues/4#issuecomment-6412265511
[i4-review]: https://github.com/Nano-Collective/nanocoder-desktop/issues/4#issuecomment-6413819518
[nc-trust-match]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/config/preferences.ts#L216-L231
[nc-grant]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/config/preferences.ts#L285-L299
[nc-plugin-trust]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/plugins/host.ts#L72-L88
[nc-acp-exit]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-server.ts#L27-L48
[nc-hook-env]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/services/lifecycle-hooks.ts#L326-L327
[nc-bash-env]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/services/bash-executor.ts#L194
[nc-69b4891]: https://github.com/Nano-Collective/nanocoder/commit/69b4891cf47ac372d90ed1509a744de5635478a0
[i5]: https://github.com/Nano-Collective/nanocoder-desktop/issues/5
[i5-pick]: https://github.com/Nano-Collective/nanocoder-desktop/issues/5#issuecomment-6412298677
[i5-review]: https://github.com/Nano-Collective/nanocoder-desktop/issues/5#issuecomment-6413961442
[i5-follow]: https://github.com/Nano-Collective/nanocoder-desktop/issues/5#issuecomment-6428043351
[i12]: https://github.com/Nano-Collective/nanocoder-desktop/issues/12
[nc-mode-map]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-capabilities.ts#L56-L60
[nc-approval]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/tools/approval-policy.ts#L49-L63
[nc-cli-mode]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/cli.tsx#L763-L768
[nc1899]: https://github.com/Nano-Collective/nanocoder/issues/1899
[nc1900]: https://github.com/Nano-Collective/nanocoder/issues/1900
[nc1889]: https://github.com/Nano-Collective/nanocoder/issues/1889
[nc1689]: https://github.com/Nano-Collective/nanocoder/issues/1689
[nc-permission]: https://github.com/Nano-Collective/nanocoder/blob/f5d82179f5032dc4990916e22a72d02f0feb2343/source/acp/acp-permission.ts#L11-L76
