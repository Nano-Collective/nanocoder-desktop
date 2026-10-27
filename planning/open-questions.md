# Open questions

Every question that still needs an answer, who owns it, and which milestone it blocks.

- Status: Draft
- Last updated: 2026-10-27
- Drafted by: @akramcodez

## How to use this list

- **Owner** is the person expected to drive the answer, not necessarily to make the call. Build and scope calls rest with @will-lamerton while he leads review. Nanocoder Desktop is a Nano Collective org project, so day-to-day calls rest with the NC core team (`@Nano-Collective/core-team`), not with one named person.
- **Blocks** names the earliest milestone that cannot exit without an answer. Milestones are defined in [`roadmap.md`](roadmap.md).
- When a question is answered, move the answer into [`decisions.md`](decisions.md) and mark the question "Answered" here with a link. Do not delete it.

## Whitepaper questions 1 to 9

From [whitepaper, Open questions][wp-questions].

| ID | Question | Current state | Owner | Blocks | Link |
|---|---|---|---|---|---|
| OQ-01 | Does the first public release need a user-installed Nanocoder, or ship a bundled tested version? | Proposed (awaiting @will-lamerton): installed for the prototype, bundled and pinned with an override for the public release (`DEC-11`). | NC core team | Technical gate (which artefact the gate spawns) | [#117][i117] |
| OQ-02 | Which Nanocoder versions and ACP capabilities are supported? | Proposed (awaiting @will-lamerton): the bundled version, plus newer versions above a minimum through the override, with startup capability checks (`DEC-12`). The minimum is not set. | NC core team | Technical gate | [#117][i117] |
| OQ-03 | Which subagent event, child-session, cancellation and approval surfaces can be supported without Nanocoder-specific version coupling? | Open. At Nanocoder `8a5f4d4`, ACP shows a subagent only as the `agent` tool card with a polled title; there are no child IDs, no per-child cancel, and one approval handler per process ([`subagents.md`](features/subagents.md)). [nanocoder#1105][nc1105] is open. | NC core team | Milestone 1 (`SP-05`) | [Whitepaper][wp-questions] |
| OQ-04 | Is SQLite acceptable as a new desktop dependency and migration surface? | Answered in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3): yes, through `node:sqlite` with `better-sqlite3` as the fallback (`DEC-04`). | NC core team | Milestone 1 | [Whitepaper][wp-questions] |
| OQ-05 | Which code, diff and PTY libraries meet licence and platform requirements? | Answered in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3): CodeMirror 6, Git's own diff output, `node-pty` with `@xterm/xterm` (`DEC-28`). | NC core team | Milestone 2 (diff), Milestone 3 (PTY) | [Whitepaper][wp-questions] |
| OQ-06 | One app-wide browser profile, or one per project? | Open. Trade-offs in [`data-model.md`](data-model.md#browser-partition). | NC core team | Milestone 3 | [Whitepaper][wp-questions] |
| OQ-07 | Which external editors get first-class "Open in editor" support? | Open. | NC core team | Milestone 2 | [Whitepaper][wp-questions] |
| OQ-08 | When does full-text chat and file search become worth its index and retention surface? | Open, and deferred: search is on the "Later" list. Not a v1 blocker. | NC core team | None in v1 | [Whitepaper][wp-questions] |
| OQ-09 | Separate repository or a Nanocoder workspace package? | Proposed (awaiting @will-lamerton): separate repository (`DEC-10`). The repository exists already. | @will-lamerton (to record) | Stage 4 repository setup | [#117][i117] |

## Questions raised in review issues

| ID | Question | Current state | Owner | Blocks | Link |
|---|---|---|---|---|---|
| OQ-10 | Signing, notarisation and updates. Is signing a v1 requirement or a later milestone, and what does an unsigned prototype tell users? Who holds the Apple and Windows signing identities (the Nano Collective or an individual), who pays, and how does CI use them? What is the update channel (for example GitHub Releases with `electron-updater`), and how is a lost or rotated key handled? | Open. No responses. All sub-questions are listed in [`security.md`](security.md#signing-notarisation-and-update-keys). | @will-lamerton (governance), NC core team | Milestone 4 and any public binary | [#120][i120] |
| OQ-11 | Should browser capabilities run in a low-privilege browser subagent with no workspace tools? | Open. @akramcodez proposed it; @puri-adityakumar kept it as an open question because a subagent's summary could still carry injected text back, so approvals are needed either way. | NC core team | None in v1 if `DEC-15` is accepted | [#108][i108], [reply][i108-c] |
| OQ-12 | Does Nanocoder Desktop plan for Scriptura plugin compatibility? | Open, unanswered. Context: Scriptura's AI layer is moving out of its plugin system, and plugin capability and trust scoping is build-time work there ([Scriptura whitepaper][scriptura]). Suggestion (not discussed): answer "not in v1", since Desktop has no plugin system and Nanocoder plugins already load per session. | NC core team, with @jason1015-coder | None in v1 | [#118 comment][i118-plugin] |
| OQ-21 | Will the build-approval note, with rationale and the reason the review window closed early, be recorded on the whitepaper page? | Open. The page shows only the status change ([approval commit][approval]). [How a project comes to life][lifecycle] makes the note mandatory and asks for a recorded reason when a window is shortened. | @will-lamerton | None technically. Affects the public record. | [Approval commit][approval] |
| OQ-24 | Should #121 and #122 merge, and in which order? | Proposed (awaiting @will-lamerton): #121 first, then #122 rebased. #121's `session/close` row should now say the fix merged. | @will-lamerton | None technically | [#121][pr121], [#122][pr122] |

## New questions found while planning

All found by reading Nanocoder source at `8a5f4d4` or the NC docs. None has been raised publicly yet. Ready-to-post drafts are in [`proposed-issues.md`](proposed-issues.md).

| ID | Question | Why it matters | Owner | Blocks | Link |
|---|---|---|---|---|---|
| OQ-13 | What happens to Nanocoder's built-in `browser` tool in desktop sessions? | Nanocoder now ships a `browser` tool that drives its own headless Chromium, reaches public sites (it blocks private and metadata addresses) and asks for approval unless it is in `alwaysAllow` ([nanocoder#1626][nc1626], [source][nc-browser]). In a desktop session it would bypass the desktop's "public sites only after opt-in" rule and the `DEC-15` boundary. The only off switch is `nanocoder.disabledTools` in the user's config ([source][nc-disabled]), and writing to that file is the option @will-lamerton ruled out in [#116][i116]. Options: a per-session or CLI way to disable it (Nanocoder change), routing it to the desktop's browser, or accepting two browsers. | NC core team | Milestone 3 | [nanocoder#1626][nc1626] |
| OQ-14 | How does desktop project trust map to Nanocoder's directory trust? | `nanocoder --acp` exits at startup if its working directory is not trusted ([nanocoder#1847][nc1847], [source][nc-trust]). The VS Code extension passes `--trust-directory` instead ([docs][nc-acp-trust]), which lasts one run. Proposed (awaiting @will-lamerton) in [#4](https://github.com/Nano-Collective/nanocoder-desktop/issues/4): the desktop asks, then records trust in Nanocoder's own store with one short launch under `NANOCODER_TRUST_DIRECTORY=1`; no other launch sets it (`DEC-30`, [details](acp-integration.md#directory-trust)). | NC core team | Technical gate | [#4](https://github.com/Nano-Collective/nanocoder-desktop/issues/4) |
| OQ-15 | Which ACP mode do desktop threads start in? | Nanocoder starts every ACP session in `auto-accept`, where file edits apply without a prompt ([source][nc-mode], [docs][nc-acp-modes]). Proposed (awaiting @will-lamerton) in [#5](https://github.com/Nano-Collective/nanocoder-desktop/issues/5): start in `normal`, with an explicit per-project default that is never `yolo`, and `session/set_mode` before every first prompt (`DEC-31`, [details](acp-integration.md#session-mode)). | NC core team | Technical gate | [#5](https://github.com/Nano-Collective/nanocoder-desktop/issues/5) |
| OQ-16 | How do durable threads survive Nanocoder's session retention? | Nanocoder deletes sessions not accessed for 30 days, and the oldest once there are more than 100, unless `sessions.retentionDays` or `sessions.maxSessions` are changed ([source][nc-retention]). A desktop thread pointing at a deleted session can only become view-only. Options: accept and explain it; let the user see and change the setting through Nanocoder; ask Nanocoder for a way to exempt sessions a client still references. | NC core team | Milestone 4 | [Source][nc-retention] |
| OQ-17 | Which transport does the desktop's browser-control MCP server use once Nanocoder honours `mcpServers`? | ACP allows stdio, HTTP and SSE servers, and SDK 1.4.0 adds an unstable MCP-over-ACP transport (`type: "acp"`, `mcp/connect`, `mcp/message`). Stdio needs a helper process that reaches back into the desktop; HTTP needs a localhost port and a per-session secret header; MCP-over-ACP needs nothing extra but is unstable. Trade-offs in [`browser.md`](features/browser.md#adapter-transport). | NC core team | Milestone 3 | [#116][i116] |
| OQ-18 | Who owns the Nanocoder changes other than `mcpServers`? | A snapshot-read ACP method (`DEC-14`), the subagent event projection (`OQ-03`), honouring `session/set_mode` mid-turn ([nanocoder#1857][nc1857]), a way to disable the built-in browser (`OQ-13`) and capability declarations for extension methods have no named owner. List in [`acp-integration.md`](acp-integration.md#nanocoder-changes-needed). | NC core team with Nanocoder maintainers | Varies | [`acp-integration.md`](acp-integration.md#nanocoder-changes-needed) |
| OQ-19 | What happens when the user switches project while a turn is running? | v1 has one active project ([whitepaper, Main window][wp-window]), but nothing says whether the previous project's process keeps running in the background. Suggestion (not discussed): keep it running until the turn ends, then idle-shut it down; never run two root turns in one process. | NC core team | Milestone 1 | [Whitepaper][wp-window] |
| OQ-20 | Was the repository created on a recorded decision? | @will-lamerton wrote on [#115][i115] that the repository should not be created until the maintainer question is settled and recorded. `Nano-Collective/nanocoder-desktop` was created on 22 October; neither #115 nor #117 is recorded on the whitepaper page. Unverified: who created it and why. | @will-lamerton | Stage 4 | [#115][i115] |
| OQ-22 | Does Nanocoder run under Electron's Node mode, a utility process, or a bundled Node 22 sidecar? | Electron's security checklist says to review fuses, and disabling the `runAsNode` fuse makes `child_process.fork` throw ([Electron fuses][el-fuses]). Running Nanocoder with `ELECTRON_RUN_AS_NODE` therefore keeps that fuse on. Nanocoder requires Node 22 or newer ([source][nc-engines]); Electron 45.0.0 embeds Node 24.22.0 ([releases][el-releases]), so Node mode is viable. A utility process cannot write to its child's stdin ([utility process][el-utility]), so it cannot host an ACP server over stdio and is ruled out. The choice is now Node mode (fuse kept on) or a sidecar. | NC core team | Technical gate (measure), Milestone 4 (ship) | [Whitepaper, Distribution][wp-dist] |
| OQ-23 | Which renderer bundler, packager, end-to-end test runner and native rebuild approach? | Answered in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3): `electron-vite`, `electron-builder`, Playwright, the packager's built-in rebuild (`DEC-28`). | NC core team | Scaffold | [`tech-stack.md`](tech-stack.md#electron-specific-choices) |
| OQ-25 | How does the cross-platform CI run, given the shared `pr-checks` workflow runs on `ubuntu-latest` only? | Answered in [#10](https://github.com/Nano-Collective/nanocoder-desktop/issues/10): local jobs beside the shared Linux checks, advisory at first (`DEC-37`). | NC core team | Milestone 1 | [Shared workflow][shared-prchecks] |

## Coverage check

Every issue labelled `whitepaper:nanocoder-desktop` as of 2026-10-23 appears in this file or in [`decisions.md`](decisions.md):

| Issue | Where |
|---|---|
| [#108][i108] | `DEC-15`, `OQ-11` |
| [#109][i109] | `DEC-14` |
| [#115][i115] | `DEC-09`, `OQ-20` |
| [#116][i116] | `DEC-13`, `OQ-17` |
| [#117][i117] | `DEC-10` to `DEC-12`, `OQ-01`, `OQ-02`, `OQ-09` |
| [#118][i118] | `DEC-16`, `DEC-17`, `OQ-12` |
| [#119][i119] | `DEC-18` |
| [#120][i120] | `DEC-20`, `OQ-10` |

[wp-questions]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L719-L733
[wp-window]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L147-L166
[wp-dist]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L564-L583
[approval]: https://github.com/Nano-Collective/docs/commit/7a7a6208c3235d03cf59b82634d712b4aa306a5f
[lifecycle]: https://docs.nanocollective.org/collective/projects/how-a-project-comes-to-life
[scriptura]: https://docs.nanocollective.org/collective/whitepapers/scriptura
[i108]: https://github.com/Nano-Collective/docs/issues/108
[i108-c]: https://github.com/Nano-Collective/docs/issues/108#issuecomment-6201044153
[i109]: https://github.com/Nano-Collective/docs/issues/109
[i115]: https://github.com/Nano-Collective/docs/issues/115
[i116]: https://github.com/Nano-Collective/docs/issues/116
[i117]: https://github.com/Nano-Collective/docs/issues/117
[i118]: https://github.com/Nano-Collective/docs/issues/118
[i118-plugin]: https://github.com/Nano-Collective/docs/issues/118#issuecomment-6214325110
[i119]: https://github.com/Nano-Collective/docs/issues/119
[i120]: https://github.com/Nano-Collective/docs/issues/120
[pr121]: https://github.com/Nano-Collective/docs/pull/121
[pr122]: https://github.com/Nano-Collective/docs/pull/122
[nc1105]: https://github.com/Nano-Collective/nanocoder/issues/1105
[nc1626]: https://github.com/Nano-Collective/nanocoder/pull/1626
[nc1847]: https://github.com/Nano-Collective/nanocoder/pull/1847
[nc1857]: https://github.com/Nano-Collective/nanocoder/issues/1857
[nc-browser]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/tools/browser.tsx#L14-L91
[nc-disabled]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/config/index.ts#L476-L483
[nc-trust]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-server.ts#L24-L36
[nc-acp-trust]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L97-L99
[nc-acp-modes]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L33
[nc-mode]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L862-L873
[nc-retention]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/session/session-manager.ts#L521-L607
[nc-engines]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/package.json#L32-L34
[nc-prchecks]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/.github/workflows/pr-checks.yml
[shared-prchecks]: https://github.com/Nano-Collective/.github/blob/8d5dd13247a4a2e4a9937ef5448c89dae933d5ed/.github/workflows/pr-checks.yml
[el-fuses]: https://www.electronjs.org/docs/latest/tutorial/fuses
[el-releases]: https://releases.electronjs.org/release/v45.0.0
[el-utility]: https://www.electronjs.org/docs/latest/api/utility-process
