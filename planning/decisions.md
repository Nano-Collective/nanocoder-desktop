# Decision register

Every decision the plan relies on, with its status, where it was made, and what is still missing.

- Status: Draft
- Last updated: 2026-10-27
- Drafted by: @akramcodez

## How to read this register

Statuses follow the [legend in `index.md`](index.md#status-legend). When sources disagree, this order wins:

1. @will-lamerton (founder): his issues, pull request text and review comments.
2. The Nano Collective docs on `main`: process, stack suggestions, project infrastructure, brand.
3. The approved whitepaper on `main`. Open pull requests against it ([#121][pr121], [#122][pr122]) count as pending.
4. @puri-adityakumar's replies. Proposed until @will-lamerton agrees.
5. Other contributors (@akramcodez, @jason1015-coder). Input only.
6. This planning set. Always labelled Suggestion (not discussed).

The date is when the decision or proposal was made, not when it was recorded here. Open questions behind Open entries are in [`open-questions.md`](open-questions.md).

## Register

| ID | Decision | Status | Source | Date | Notes |
|---|---|---|---|---|---|
| DEC-01 | Nanocoder Desktop is approved for build. | Decided | [Approval commit][approval] | 2026-10-12 | The review window opened on 4 October with a 3 November close ([commit][window]) and was closed on 12 October at approval. The process requires a dated note with rationale on the whitepaper page ([How a project comes to life][lifecycle]); none is there yet. See `OQ-21`. |
| DEC-02 | Electron, not Tauri, for v1. | Decided | [Whitepaper, Alternatives][wp-alt] | 2026-10-12 | Tauri v2 stays the recorded alternative. Switch only if measured installer or memory targets become a release gate, never because "Tauri is lightweight". |
| DEC-03 | Stack: Electron, React, TypeScript, the ACP SDK, a supervised Nanocoder child, system Git, a PTY, and an isolated `WebContentsView` behind a typed browser-control adapter. | Decided | [Whitepaper, Recommendation: Electron][wp-alt] | 2026-10-12 | SQLite is recommended in the same paragraph but its acceptance is whitepaper question 4, so it has its own entry (`DEC-04`). |
| DEC-04 | SQLite as the desktop metadata store, through `node:sqlite`, with `better-sqlite3` as the fallback behind the same interface. | Decided | [Whitepaper, question 4][wp-questions], [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3) | 2026-10-26 | `node:sqlite` is a release candidate on Node 24.15 and later; store specs run on Node 24 as well as 22. See [`data-model.md`](data-model.md#sqlite-library). |
| DEC-05 | Integrate through `nanocoder --acp` as a supervised child over stdio. Stdout carries protocol only; stderr goes to a bounded, redacted, in-memory ring. | Decided | [Whitepaper, Architecture][wp-arch] | 2026-10-12 | |
| DEC-06 | Rejected: a local web app, importing Nanocoder internals into Electron main, scraping the Ink TUI, the legacy `--vscode` WebSocket, and a new agent core. | Decided | [Whitepaper, Rejected first-release alternatives][wp-alt] | 2026-10-12 | |
| DEC-07 | One supervised ACP process per project, one user-initiated root turn at a time, bounded Nanocoder subagents. | Decided | [Whitepaper, Process policy][wp-process] | 2026-10-12 | Nanocoder now queues prompts per session instead of rejecting them ([source][nc-queue]), so the desktop must enforce "one root turn" itself (`CHAT-17`). |
| DEC-08 | The desktop never stores full ACP messages, file contents, tool results or stderr. Nanocoder replay is authoritative for history. | Decided | [Whitepaper, Sources of truth][wp-truth] | 2026-10-12 | |
| DEC-09 | Maintainer commitment for Stage 3. This plan names no individual maintainer: Nanocoder Desktop is a Nano Collective org project, owned through `@Nano-Collective/core-team`. | Proposed (awaiting @will-lamerton) | [#115][i115], [confirmation][i115-c] | 2026-10-12 | @will-lamerton asked for the answer to be recorded on the whitepaper page before the repository is created. Nothing is recorded yet. |
| DEC-10 | Repository shape: a separate repository, not a Nanocoder workspace package. | Proposed (awaiting @will-lamerton) | [#117][i117], [proposal][i117-c] | 2026-10-16 | Answers whitepaper question 9. `Nano-Collective/nanocoder-desktop` already exists (created 2026-10-22, public). Unverified: who created it and on whose decision. The GitHub repository metadata and the org audit log would confirm. |
| DEC-11 | Nanocoder bundling: the prototype uses the user's installed Nanocoder; the first public release bundles a pinned, tested Nanocoder with an override for contributors. | Proposed (awaiting @will-lamerton) | [#117][i117], [proposal][i117-c] | 2026-10-16 | Answers whitepaper question 1. Matches the whitepaper's [Distribution][wp-dist] section. |
| DEC-12 | Supported versions: officially support the bundled version; allow newer versions above a minimum through the override; check ACP capabilities at startup and turn off what is missing. | Proposed (awaiting @will-lamerton) | [#117][i117], [proposal][i117-c] | 2026-10-16 | Answers whitepaper question 2. The minimum version is not set. See [`acp-integration.md`](acp-integration.md#supported-nanocoder-versions). |
| DEC-13 | `mcpServers` route: change Nanocoder to honour the `mcpServers` a client passes on `session/new`, `session/load` and `session/resume`, so the browser tool exists only in desktop sessions. @puri-adityakumar builds it on a Nanocoder branch and opens a pull request before the browser milestone. | Proposed (awaiting @will-lamerton) | [#116][i116], [proposal][i116-c] | 2026-10-16 | Option 2 of the two @will-lamerton listed. Nanocoder loads MCP servers once per process into a shared tool registry ([source][nc-mcp-init]), so this is a per-session tool registry change. The transport for the desktop's server is open (`OQ-17`). |
| DEC-14 | Git baseline: use Nanocoder's pre-edit file copies (the `timeline/revert` mechanism) as the baseline, add a small ACP method to read them, and show an "Agent changes" view beside the full diff, falling back to the touched-files label. | Proposed (awaiting @will-lamerton) | [#109][i109], [proposal][i109-c] | 2026-10-15 | The whitepaper lists exact per-turn attribution under "Later", so this would move it forward. Snapshot limits apply ([`git-review.md`](features/git-review.md#agent-changes-view)). |
| DEC-15 | Browser trust boundary: label page content as page data; allow agent control of public sites only in `normal` mode; Nanocoder approves workspace actions and the desktop approves browser actions; neither approves on the user's behalf. | Proposed (awaiting @will-lamerton) | [#108][i108], [proposal][i108-c] | 2026-10-15 | The low-privilege browser subagent stays an open question (`OQ-11`). @akramcodez has not yet replied to Puri's proposal. |
| DEC-16 | Relationship to Scriptura: different products (IDE and ADE), no shared code, shared ACP conformance tests in the Nanocoder repository, Nanocoder bugs fixed in Nanocoder, "Open in Scriptura" early, cross-app chat continuation later. | Proposed (awaiting @will-lamerton) | [#118][i118], [proposal][i118-c] | 2026-10-16 | Scriptura plugin compatibility is unanswered (`OQ-12`). |
| DEC-17 | Product focus stays on coding, not a general chat app. | Proposed (awaiting @will-lamerton) | [#118][i118], [proposal][i118-c] | 2026-10-16 | Responds to @jason1015-coder's [suggestion][i118-j]. |
| DEC-18 | Research citations: replace the unpublished `codex-inspired-nanocoder-desktop-research.md` with six cited findings and nine references, pinned to Nanocoder `dc8e121`. | Proposed (awaiting @will-lamerton) | [#119][i119], [#122][pr122] (draft), [reply][i119-c] | 2026-10-15 | Three findings changed after `dc8e121`: `session/close` is now handled, overlapping prompts now queue instead of being rejected, and Nanocoder is at 1.31.0. See [`acp-integration.md`](acp-integration.md#known-nanocoder-acp-quirks). |
| DEC-19 | Editorial update: the durable replay row cites Nanocoder's docs, the `session/close` row links the fix, and Next steps lists the maintainer and repository-shape prerequisites. | Proposed (awaiting @will-lamerton) | [#121][pr121] (open) | 2026-10-12 | Authored by @will-lamerton, so the content reflects his view, but it is not merged. Merge order: #121 first, then #122 rebased ([comment][pr122-order]). The `session/close` row should now say "fixed" rather than "fix proposed". |
| DEC-20 | Signing, notarisation, the update channel and signing-key custody. | Open | [#120][i120] | 2026-10-12 | No responses. Every sub-question is listed in [`security.md`](security.md#signing-notarisation-and-update-keys) and `OQ-10`. |
| DEC-21 | Nanocoder implements `session/close`. | Decided | [nanocoder#1709][nc1709] (merged) | 2026-10-19 | Closes the session in memory and keeps it on disk, so load and resume still work afterwards. |
| DEC-22 | Git review is read-only in v1. Staging, discarding, committing, branches, worktrees and GitHub comments come later. | Decided | [Whitepaper, Git diff and review][wp-git] | 2026-10-12 | |
| DEC-23 | Browser defaults: localhost allowed; public HTTP(S) only after the user enables it in settings; sensitive submissions, purchases, permission changes, deletion and downloads need approval; browser permissions, uploads, popups and external protocols denied by default. | Decided | [Whitepaper, Agent-controlled browser and Threat model][wp-browser] | 2026-10-12 | |
| DEC-24 | The desktop offers Nanocoder only bounded, project-root-validated file reads over ACP: no filesystem writes and no terminal capability. | Decided | [Whitepaper, Why ACP][wp-why] | 2026-10-12 | |
| DEC-25 | Launch Nanocoder only through a trusted absolute runtime with an argument array; never through shell interpolation or a PATH-resolved shim. A bundled Node 22 sidecar is the fallback if Electron's Node mode does not validate on all three platforms. | Decided | [Whitepaper, Distribution][wp-dist] | 2026-10-12 | Which runtime ships is open until measured (`OQ-22`). |
| DEC-26 | MIT licence, copyright "Nano Collective"; `README.md`, `CONTRIBUTING.md`, `LICENSE`; shared CI; public from day one with a README saying the project is pre-v0.1. | Decided | [Creating a new project][creating], [How a project comes to life][lifecycle] | | `README.md`, `CONTRIBUTING.md` and `LICENSE` were added in phase S.1. |
| DEC-27 | TypeScript toolchain defaults: pnpm, ESM, strict TypeScript, Biome, AVA through `tsx`, c8 with an 80% line floor and fail-on-drop, Knip, changesets, the shared `pr-checks` caller, both rulesets, `CODEOWNERS` naming `@Nano-Collective/core-team`. | Decided | [Stack suggestions][stack], [Project infrastructure][infra] | | Stack suggestions are defaults, not laws. Any divergence is documented in `CONTRIBUTING.md` ([Creating a new project][creating]). |
| DEC-28 | Electron-specific tooling: `electron-vite`, `electron-builder` with `electron-updater`, its built-in native rebuild, `node-pty` with `@xterm/xterm`, Git's own diff output, CodeMirror 6 read-only, Playwright, `zod` 4, and linted spec files. | Decided | [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3), [picks](https://github.com/Nano-Collective/nanocoder-desktop/issues/3#issuecomment-6412135950), [review](https://github.com/Nano-Collective/nanocoder-desktop/issues/3#issuecomment-6413649344) | 2026-10-26 | Review points (Playwright needs the `nodeCliInspect` fuse, macOS `.zip`, `node-pty` on Linux) are in [`tech-stack.md`](tech-stack.md#electron-specific-choices). |
| DEC-29 | How the desktop handles Nanocoder's built-in `browser` tool, which drives its own headless Chromium. | Open | [nanocoder#1626][nc1626] | | `OQ-13`. |
| DEC-30 | Desktop trust maps to Nanocoder's own trust store. The desktop asks the user, then records trust through Nanocoder with one short launch under `NANOCODER_TRUST_DIRECTORY=1`. No other launch sets it or passes `--trust-directory`, and an inherited value is dropped. The desktop never writes Nanocoder's files. A later refusal shows Nanocoder's reason and the prompt again, never an automatic restart. | Proposed (awaiting @will-lamerton) | [#4](https://github.com/Nano-Collective/nanocoder-desktop/issues/4), [pick](https://github.com/Nano-Collective/nanocoder-desktop/issues/4#issuecomment-6412265511), [review](https://github.com/Nano-Collective/nanocoder-desktop/issues/4#issuecomment-6413819518) | 2026-10-27 | Details and known gaps in [`acp-integration.md`](acp-integration.md#directory-trust). The review asks Nanocoder for a read-only trust status command, a grant tied to the fingerprint shown, a distinct refusal exit code and a versioned fingerprint ([Nanocoder changes needed](acp-integration.md#nanocoder-changes-needed)). `OQ-14`. |
| DEC-31 | Which ACP mode desktop threads start in. Nanocoder starts every ACP session in `auto-accept`. | Open | [Source][nc-mode] | | `OQ-15`. DEC-15 depends on `normal` mode. |
| DEC-32 | Keep this planning set in `planning/`, not `docs/`, so the docs site does not publish drafts. | Suggestion (not discussed) | [`lib/projects.ts`][projects-ts] | 2026-10-23 | Chosen by @akramcodez while drafting. Raise with the NC core team when this set is first reviewed. |
| DEC-33 | Thread state machine: New, Ready, Running, WaitingApproval, Interrupted, Failed, ViewOnly; archive is separate UI metadata. | Decided | [Whitepaper, Thread states][wp-states] | 2026-10-12 | Behaviour per state is in [`architecture.md`](architecture.md#thread-state-machine). |
| DEC-34 | Durable chats rely on Nanocoder's session files; the persisted Nanocoder session ID is the durable join key; session listing is best-effort discovery. | Decided | [Whitepaper, Project and session identity][wp-identity] | 2026-10-12 | Nanocoder's retention deletes sessions after 30 days idle or beyond 100 sessions ([source][nc-retention]). `OQ-16`. |
| DEC-35 | Run a technical gate before Milestone 1: spawn the selected artefact with `--acp`, record capabilities, complete a real turn, restart both processes, resume, and exercise both approval paths. | Decided | [Whitepaper, Next steps][wp-next] | 2026-10-12 | Exit criteria in [`roadmap.md`](roadmap.md#technical-gate). |
| DEC-36 | Visual identity: `DESIGN.md` departs from the NC default visual identity. Keep it as a documented divergence, or adopt the default. | Open | [Creating a new project, Visual identity][creating], [`DESIGN.md`](../DESIGN.md#open-design-questions) | 2026-10-26 | Details are in `DESIGN.md`. Diverging is allowed if `CONTRIBUTING.md` documents it ([Creating a new project][creating]). |
| DEC-37 | Cross-platform CI: local macOS and Windows unit jobs on Node 22 and 24, an ACP integration job on all three platforms with its own test script, a package smoke job behind a job-level condition, and an end-to-end job from Milestone 1. Only the six NC checks are required; local jobs start advisory. | Decided | [#10](https://github.com/Nano-Collective/nanocoder-desktop/issues/10), [picks](https://github.com/Nano-Collective/nanocoder-desktop/issues/10#issuecomment-6412197487), [review](https://github.com/Nano-Collective/nanocoder-desktop/issues/10#issuecomment-6415011518) | 2026-10-26 | Details in [`testing-strategy.md`](testing-strategy.md#cross-platform-ci). |

## Counts

| Status | Entries |
|---|---|
| Decided | 20 (`DEC-01` to `DEC-08`, `DEC-21` to `DEC-28`, `DEC-33` to `DEC-35`, `DEC-37`) |
| Proposed (awaiting @will-lamerton) | 12 (`DEC-09` to `DEC-19`, `DEC-30`) |
| Open | 4 (`DEC-20`, `DEC-29`, `DEC-31`, `DEC-36`) |
| Suggestion (not discussed) | 1 (`DEC-32`) |

## What @will-lamerton needs to answer

Ordered by what they block.

| Blocks | Decision | Ask |
|---|---|---|
| Repository setup (Stage 4) | `DEC-09`, `DEC-10` | Settle the maintainer commitment and repository shape and record them on the whitepaper page, as [#115][i115] and [#117][i117] require. Confirm the repository that already exists is the intended one. |
| Technical gate | `DEC-11`, `DEC-12`, `DEC-30`, `DEC-31` | Agree the bundling direction and version policy, the trust mapping, and the starting ACP mode. |
| Milestone 1 | `DEC-15` | Agree the browser trust boundary, since the starting mode depends on it. |
| Milestone 1 (first UI work) | `DEC-36` | Accept `DESIGN.md`'s visual identity as a documented divergence, or adopt the NC default. |
| Milestone 2 | `DEC-14` | Decide whether the "Agent changes" view is v1 or later. |
| Milestone 3 | `DEC-13`, `DEC-29` | Agree the `mcpServers` change and what happens to Nanocoder's built-in `browser` tool in desktop sessions. |
| Milestone 4 and release | `DEC-20` | Signing, notarisation, update channel and key custody. |
| Whitepaper accuracy | `DEC-18`, `DEC-19` | Merge #121, then #122 after rebase. |

[approval]: https://github.com/Nano-Collective/docs/commit/7a7a6208c3235d03cf59b82634d712b4aa306a5f
[window]: https://github.com/Nano-Collective/docs/commit/60283a571f5536558a2becb17b973c3512cfad68
[lifecycle]: https://docs.nanocollective.org/collective/projects/how-a-project-comes-to-life
[creating]: https://docs.nanocollective.org/collective/projects/creating-a-new-project
[stack]: https://docs.nanocollective.org/collective/projects/stack-suggestions
[infra]: https://docs.nanocollective.org/collective/projects/project-infrastructure
[projects-ts]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/lib/projects.ts
[wp-arch]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L189-L246
[wp-why]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L267-L275
[wp-process]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L277-L284
[wp-truth]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L344-L355
[wp-states]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L168-L187
[wp-identity]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L389-L398
[wp-git]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L424-L452
[wp-browser]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L473-L633
[wp-alt]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L517-L562
[wp-dist]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L564-L583
[wp-next]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L650-L696
[wp-questions]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L719-L733
[i108]: https://github.com/Nano-Collective/docs/issues/108
[i108-c]: https://github.com/Nano-Collective/docs/issues/108#issuecomment-6201044153
[i109]: https://github.com/Nano-Collective/docs/issues/109
[i109-c]: https://github.com/Nano-Collective/docs/issues/109#issuecomment-6202361982
[i115]: https://github.com/Nano-Collective/docs/issues/115
[i115-c]: https://github.com/Nano-Collective/docs/issues/115#issuecomment-6124303598
[i116]: https://github.com/Nano-Collective/docs/issues/116
[i116-c]: https://github.com/Nano-Collective/docs/issues/116#issuecomment-6208187468
[i117]: https://github.com/Nano-Collective/docs/issues/117
[i117-c]: https://github.com/Nano-Collective/docs/issues/117#issuecomment-6208555047
[i118]: https://github.com/Nano-Collective/docs/issues/118
[i118-c]: https://github.com/Nano-Collective/docs/issues/118#issuecomment-6210219535
[i118-j]: https://github.com/Nano-Collective/docs/issues/118#issuecomment-6127893521
[i119]: https://github.com/Nano-Collective/docs/issues/119
[i119-c]: https://github.com/Nano-Collective/docs/issues/119#issuecomment-6211006961
[i120]: https://github.com/Nano-Collective/docs/issues/120
[pr121]: https://github.com/Nano-Collective/docs/pull/121
[pr122]: https://github.com/Nano-Collective/docs/pull/122
[pr122-order]: https://github.com/Nano-Collective/docs/pull/122#issuecomment-6191239089
[nc1626]: https://github.com/Nano-Collective/nanocoder/pull/1626
[nc1709]: https://github.com/Nano-Collective/nanocoder/pull/1709
[nc1847]: https://github.com/Nano-Collective/nanocoder/pull/1847
[nc-queue]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L204-L215
[nc-mode]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-agent.ts#L862-L873
[nc-mcp-init]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/plain/initialize.ts#L183-L196
[nc-retention]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/session/session-manager.ts#L521-L607
