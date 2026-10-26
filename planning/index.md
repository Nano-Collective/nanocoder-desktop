# Nanocoder Desktop planning set

The map of the Nanocoder Desktop planning documents, the order to read them in, and how to keep them current.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## What this folder is

Nanocoder Desktop is a local-first desktop workspace around the Agent Client Protocol (ACP) server that Nanocoder already ships. The Nano Collective approved it for build on 12 October 2026 ([approval commit][approval]). The case for building it is the [Nanocoder Desktop whitepaper][wp-site]; these files turn that whitepaper, its review issues and the current Nanocoder source into a plan a contributor can build from.

The whitepaper stays canonical. Where this folder and the whitepaper on `main` of the [docs repository][docs-repo] disagree, the whitepaper wins until the difference is recorded upstream. Every decision here carries a status and a link to where it was made (see [Status legend](#status-legend)).

These are planning documents, not user documentation. User-facing docs will live in `docs/`, which the docs site publishes from each project's release tags ([`lib/projects.ts`][projects-ts]). Keeping this set in `planning/` stops drafts reaching docs.nanocollective.org.

Visual design: see [`DESIGN.md`](../DESIGN.md).

## Reading order

| Step | File | What it answers |
|---|---|---|
| 1 | [`overview.md`](overview.md) | What the product is, who it is for, v1 scope, non-goals and the success picture (`SP-01` to `SP-11`). |
| 2 | [`decisions.md`](decisions.md) | What is decided, proposed and open, with sources. |
| 3 | [`open-questions.md`](open-questions.md) | What still needs an answer, who owns it and which milestone it blocks. |
| 4 | [`architecture.md`](architecture.md) | Processes, trust boundaries, IPC, the thread state machine and the key sequences. |
| 5 | [`acp-integration.md`](acp-integration.md) | How the desktop talks to `nanocoder --acp`, known quirks, and the Nanocoder changes the plan depends on. |
| 6 | [`security.md`](security.md) | Threat model and the `SEC-` rules. |
| 7 | [`data-model.md`](data-model.md) | What the desktop stores in SQLite, and what it never stores. |
| 8 | [`features/`](features/) | One file per v1 feature, each with requirements, edge cases and acceptance criteria. |
| 9 | [`roadmap.md`](roadmap.md) | Where the project is in the NC process, and the build in small phases with checklists: scaffold, technical gate, milestones 1 to 4. |
| 10 | [`tech-stack.md`](tech-stack.md) | Decided stack, NC toolchain defaults and the Electron choices still open. |
| 11 | [`testing-strategy.md`](testing-strategy.md) | How each requirement is tested, including the restart-and-resume test. |
| 12 | [`repo-setup.md`](repo-setup.md) | Everything to create at scaffold time, and the launch checklist. |
| 13 | [`release-and-distribution.md`](release-and-distribution.md) | Bundling Nanocoder, packaging, signing and the release flow. |
| 14 | [`risks.md`](risks.md) | The open risks with likelihood, impact and mitigation. |
| 15 | [`glossary.md`](glossary.md) | Terms the set relies on. |
| 16 | [`sources.md`](sources.md) | Everything read to write this set, with commits and dates. |
| 17 | [`proposed-issues.md`](proposed-issues.md) | Drafts of the issues this plan needs raised, ready to post. |

Feature files:

| File | Covers |
|---|---|
| [`features/chats-and-sessions.md`](features/chats-and-sessions.md) | Projects, threads, durable resume, view-only threads, approvals, model and mode controls (`CHAT-`). |
| [`features/subagents.md`](features/subagents.md) | Bounded Nanocoder subagents and how the desktop shows and stops them (`SUB-`). |
| [`features/file-browser.md`](features/file-browser.md) | The read-oriented project tree and preview (`FILE-`). |
| [`features/git-review.md`](features/git-review.md) | Real Git status and diffs, honest last-turn labelling and the #109 baseline (`GIT-`). |
| [`features/terminal.md`](features/terminal.md) | The single project PTY (`TERM-`). |
| [`features/browser.md`](features/browser.md) | The isolated, agent-controlled browser (`BRW-`). |

## Status legend

| Status | Meaning |
|---|---|
| **Decided** | Settled by a document on `main` (the approved whitepaper or the NC process docs), by merged code, or by @will-lamerton in writing. |
| **Proposed (awaiting @will-lamerton)** | Proposed in review, usually by @puri-adityakumar, with no reply from @will-lamerton yet. Plan around it, but do not build anything that is expensive to undo. |
| **Open** | No proposal yet, or a question nobody has answered. |
| **Suggestion (not discussed)** | An idea from this planning set that has not been raised publicly. Raise it as an issue before treating it as part of the plan. |

A requirement inherits the status of the decision behind it. If a requirement depends on something Open, it is Open too, whatever its wording.

## Requirement IDs

| Prefix | Defined in | Covers |
|---|---|---|
| `SP-` | [`overview.md`](overview.md) | The v1 success picture. |
| `ACP-` | [`acp-integration.md`](acp-integration.md) | The ACP client, process supervision and capability gating. |
| `SEC-` | [`security.md`](security.md) | Security rules that apply across features. |
| `CHAT-` | [`features/chats-and-sessions.md`](features/chats-and-sessions.md) | Projects, threads and the conversation. |
| `SUB-` | [`features/subagents.md`](features/subagents.md) | Subagent runs. |
| `FILE-` | [`features/file-browser.md`](features/file-browser.md) | The file browser. |
| `GIT-` | [`features/git-review.md`](features/git-review.md) | Git review. |
| `TERM-` | [`features/terminal.md`](features/terminal.md) | The terminal. |
| `BRW-` | [`features/browser.md`](features/browser.md) | The browser and its control adapter. |
| `DATA-` | [`data-model.md`](data-model.md) | Desktop storage. |
| `REL-` | [`release-and-distribution.md`](release-and-distribution.md) | Packaging, signing and releases. |
| `PERF-` | [`testing-strategy.md`](testing-strategy.md#performance-targets) | Measurable performance targets. |
| `A11Y-` | [`testing-strategy.md`](testing-strategy.md#accessibility-targets) | Measurable accessibility targets. |
| `DEC-` | [`decisions.md`](decisions.md) | Decision register entries. |
| `OQ-` | [`open-questions.md`](open-questions.md) | Open questions. |
| `RISK-` | [`risks.md`](risks.md) | Risks. |

## How to update these docs

1. **Change them by pull request.** Update `Last updated` in every file you touch.
2. **Update the register first.** When a decision changes status, change [`decisions.md`](decisions.md), then every file that cites it, in the same pull request. Link the comment, commit or pull request that changed it.
3. **Never renumber.** New requirements take the next unused number in their prefix. A retired requirement stays in its table, marked "Withdrawn" with the reason.
4. **Pin Nanocoder facts.** Link Nanocoder source to a commit SHA, never to `main`. When the desktop adopts a new Nanocoder version, re-check the quirks table in [`acp-integration.md`](acp-integration.md) and add the commit to [`sources.md`](sources.md).
5. **Follow the house style.** The [Brand Guidelines][brand] apply: British spelling, no em dashes, sentence case for headings and bold labels, no marketing language, full URLs. Mark anything not checked against a source as `Unverified:` and say what would confirm it.
6. **Keep visual design out.** Behaviour, states, data, keyboard access and accessibility belong here. How anything looks belongs in [`DESIGN.md`](../DESIGN.md).
7. **Push decisions upstream.** When @will-lamerton agrees to a proposal, it is recorded on the whitepaper page (he asked for this explicitly for maintainer commitment in [#115][i115] and the repository shape in [#117][i117]). Only then does the entry here become Decided.

Before opening a pull request against this folder, check that it contains no em dashes, no American spellings outside code, no visual-design vocabulary outside the `DESIGN.md` pointer lines, and no requirement ID that is referenced but never defined.

[approval]: https://github.com/Nano-Collective/docs/commit/7a7a6208c3235d03cf59b82634d712b4aa306a5f
[wp-site]: https://docs.nanocollective.org/collective/whitepapers/nanocoder-desktop
[docs-repo]: https://github.com/Nano-Collective/docs
[projects-ts]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/lib/projects.ts
[brand]: https://docs.nanocollective.org/collective/organisation/brand
[i115]: https://github.com/Nano-Collective/docs/issues/115
[i117]: https://github.com/Nano-Collective/docs/issues/117
