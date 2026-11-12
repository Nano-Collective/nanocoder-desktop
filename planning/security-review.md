# Security review (phase 4.7)

- Status: Draft
- Last updated: 2026-11-12
- Drafted by: @akramcodez

The review of every `SEC-` rule and every item of Electron's checklist against the code and its tests, and the supply-chain and scanner results at the time of review. A rule is closed only when a test proves it, including the refusal, or when a manual check is recorded here with its date. Where the review found a gap, the fix is listed with it.

## Method

1. For each `SEC-` rule in [`security.md`](security.md), find the tests that fail if the rule is broken. A test that only checks the happy path does not count.
2. Where a rule had no test that names it, check the code, then add the test or record a manual check.
3. Check each item of the [Electron checklist](security.md#electron-hardening-checklist) against the code.
4. Read the CI scanner results and the open advisories for the repository.

## Rules and their proof

Test paths are under `source/` unless they start with `e2e/` or `scripts/`. All of them run in `pnpm test:all` or `pnpm test:e2e` on every pull request.

| Rule | What proves it | Kind |
|---|---|---|
| `SEC-01` sandbox, isolation, no Node, web security on | `e2e/app.e2e.ts`: every web contents in the running app has `sandbox` and `contextIsolation` on, and Node, Node in workers and frames, insecure content, experimental and Blink features off; the renderer cannot reach `require` or `process`. Turning the sandbox off makes it fail. `main/browser/profile.spec.ts` covers the browser view | Automated, added in this phase |
| `SEC-02` narrow, validated, sender-checked IPC | `main/ipc/workspace.spec.ts` runs every method through "refuses malformed and unknown-field requests" and "refuses non-app senders before reaching a service"; `main/ipc/browser.spec.ts`, `terminal.spec.ts`, `files.spec.ts` do the same for theirs | Automated |
| `SEC-03` paths canonical and inside the root | `main/files/safe-path.spec.ts`, `main/paths.spec.ts`, `main/projects/project-service.spec.ts`, `main/terminal/terminal-service.spec.ts`, `main/files/attachments.spec.ts`; `e2e/files.e2e.ts` on all three platforms | Automated |
| `SEC-04` bounded reads, entries, diffs and time | `main/files/file-service.spec.ts`, `safe-path.spec.ts`, `acp-fs.spec.ts`, `main/git/git-service.spec.ts` | Automated |
| `SEC-05` absolute paths, argument arrays, no shell, no `PATH` at launch | `main/nanocoder/runtime.spec.ts`, `runtime-check.spec.ts`, `launch.spec.ts`, `main/terminal/shell.spec.ts`, `process-tree.spec.ts`; the packaged smoke test proves the shipped app uses its bundled runtime and ignores `NODE_OPTIONS` | Automated |
| `SEC-06` Git hardened and read-only | `main/git/run.spec.ts` (flags, scrubbed environment, subcommand allow-list), `git-service.spec.ts`, `locate.spec.ts` | Automated |
| `SEC-07` no keys, transcripts or payloads in storage or logs | `main/store/store.spec.ts` ("refuses secrets, transcripts, payloads, arbitrary fields" and the schema introspection that fails on a content-bearing column), `main/projects/trust-summary.spec.ts`, `main/nanocoder/session-controls.spec.ts` | Automated |
| `SEC-08` diagnostics bounded, redacted, reviewed by the user | `main/nanocoder/stderr-security.spec.ts` (bounds and redaction), `diagnostics-export.spec.ts` (native review of the exact snapshot, cancellation, one owner, no paths in errors), `diagnostics-security.spec.ts` | Automated, tagged in this phase |
| `SEC-09` approvals only by the user | `main/nanocoder/permissions.spec.ts` (only an offered option counts, no second answer, cancelled on close and with no handler), `e2e/approvals.e2e.ts` and `e2e/browser-agent.e2e.ts` for the desktop's own approval cards | Automated, tagged in this phase |
| `SEC-10` browser denies permissions, uploads, popups, external protocols; downloads confirmed | `main/browser/profile.spec.ts`, `e2e/browser.e2e.ts`; `e2e/app.e2e.ts` for the app UI's own session | Automated |
| `SEC-11` page content untrusted, agent confined | `main/browser/agent-policy.spec.ts`, `main/browser-control/broker.spec.ts`, `e2e/browser-agent.e2e.ts` | Automated |
| `SEC-12` browser view has no Node, preload or IPC; own partition per profile | `main/browser/profile.spec.ts`, `browser-service.spec.ts`, `origin.spec.ts`, `main/ipc/browser.spec.ts` | Automated |
| `SEC-13` typed browser actions only | `main/browser-control/broker.spec.ts`, `page-scripts.spec.ts`, `mcp-server.spec.ts`, `e2e/browser-agent.e2e.ts` | Automated |
| `SEC-14` signed releases and updates | Not built: phase 4.4 waits for the signing decisions in [#120][i120] | Open, see below |
| `SEC-15` bundled code over a custom protocol, strict CSP, no navigation or windows | `e2e/app.e2e.ts` ("loads the renderer over the app protocol, not file://", "cannot open windows", "cannot navigate away", "content security policy blocks inline scripts", and the permission test), `main/security.spec.ts` (origins, file resolution, CSP) | Automated |
| `SEC-16` `shell.openExternal` only for web addresses after a user action | `main/browser/external.spec.ts`, `browser-service.spec.ts`, `main/ipc/browser.spec.ts`, `e2e/browser.e2e.ts` | Automated |
| `SEC-17` nothing project-defined runs before trust | `main/projects/project-consent.spec.ts`, `project-service.spec.ts`, `trust-summary.spec.ts`, `main/nanocoder/trust.spec.ts`, `main/threads/project-operations.spec.ts`; `e2e/projects.e2e.ts` | Automated |
| `SEC-18` supply chain | `scripts/lib/supply-chain.spec.mjs`: every action and reusable workflow is pinned to a commit SHA, Electron is one exact version, the pnpm policy holds (seven day release age, no exotic sub-dependencies, no trust downgrade, a three package install-script allow-list) and every workflow install uses the frozen lockfile. Each check has a failing example. Audit, Semgrep and CodeQL are in the shared `pr-checks` job | Automated, added in this phase |
| `SEC-19` fuses | `scripts/lib/fuses.spec.mjs` (the policy and the real wire), the packaged smoke test (read from the shipped app, and proven by behaviour) | Automated, phase 4.2 |
| `SEC-20` ACP callbacks least privilege | `main/files/acp-fs.spec.ts`, `main/nanocoder/acp-client.spec.ts`, `main/files/files.acp.ts` against the real Nanocoder | Automated |

## Electron checklist

| # | Item | Evidence |
|---|---|---|
| 1 | Only secure content | App UI is bundled and served over `app://` (`SEC-15`); the browser view's origin policy is `main/browser/origin.spec.ts` |
| 2 | No Node for remote content | `SEC-01`, `SEC-12` |
| 3 | Context isolation | `SEC-01` test above |
| 4 | Sandbox | `SEC-01` test above; the browser view sets it in `main/browser/profile.ts` |
| 5 | Permission handlers on every session with remote content | Default session and the browser partitions deny by default (`main/index.ts`, `main/browser/profile.ts`); the permission test in `e2e/app.e2e.ts` |
| 6 | `webSecurity` on | `SEC-01` test above |
| 7 | CSP | `main/security.ts`, `main/security.spec.ts`, the inline script test in `e2e/app.e2e.ts` |
| 8 | No insecure content | `SEC-01` test above |
| 9 | No experimental features | `SEC-01` test above |
| 10 | No `enableBlinkFeatures` | `SEC-01` test above |
| 11, 12 | `<webview>` | Not used. `will-attach-webview` is cancelled for every web contents (`main/index.ts`) and `webviewTag` is checked off by the `SEC-01` test |
| 13 | Limit navigation | `will-navigate` and `will-redirect` use the allowed origins in app UI; the browser view applies its own origin policy. `e2e/app.e2e.ts` |
| 14 | Limit new windows | `setWindowOpenHandler` denies in every web contents. `e2e/app.e2e.ts` |
| 15 | `openExternal` | `SEC-16` |
| 16 | Current Electron | Pinned to an exact version and exempt from the seven day release age so a security release applies at once (`SEC-18` test). Applying releases promptly is process, not code |
| 17 | Validate IPC senders | `SEC-02` |
| 18 | No `file://` | `SEC-15` |
| 19 | Fuses | `SEC-19` |
| 20 | No Electron APIs for untrusted content | The browser view has no preload (`SEC-12`) |

## Scanners and advisories

Read on 2026-11-12, on the last pull request merged before this one.

| Check | Result |
|---|---|
| Semgrep Security Scan (shared `pr-checks`) | Passed |
| CodeQL Security Analysis | Passed; no open code scanning alert in the repository |
| Package Audit Analysis (`pnpm audit --audit-level=high` and the bundled runtime's `npm audit --audit-level=high`) | Passed. `pnpm audit` reports two moderate findings, `glob` and `minimatch`, both only through `ava`, the test runner (`.>ava>@vercel/nft>glob>minimatch`), and `pnpm why glob --prod` is empty, so neither is in the shipped app. The bundled Nanocoder tree reports five low severity findings and none higher |
| Open Dependabot alerts | Two, and neither is high. `minimatch` (medium) is the finding above. `@ai-sdk/provider-utils` (low) is in the bundled Nanocoder's lock, which is generated from its published release (`REL-04`), so the fix is a Nanocoder release |

None of these is a high finding, so the result "no unresolved high findings" holds. The two Dependabot alerts stay visible in the repository until the dependency is updated.

## What the review changed

| Finding | Fix |
|---|---|
| All five reusable workflows (`pr-checks`, `nc-review`, `changeset-check`, `release-prepare`, `update-badges`) were referenced as `@main`, a moving branch, so a change in the shared repository ran in this one unreviewed | Pinned to a commit of `Nano-Collective/.github`. Bumping it is now a pull request. The cost is that improvements to the shared workflows reach this repository only when someone bumps the pin |
| `SEC-18` had no test, only a convention | `scripts/lib/supply-chain.spec.mjs`, which also checks the repository itself, so an unpinned reference fails the build |
| `SEC-01` and the app UI's permissions had no test that read the real settings of the running app | Two tests in `e2e/app.e2e.ts`. The `SEC-01` one fails if the sandbox is switched off |
| Tests for `SEC-08` and `SEC-09` existed but did not name the rule, so the rule could not be traced | Their titles now carry the rule ID |

## Still open

- **`SEC-14`, signed releases and updates.** Phase 4.4 depends on the key custody, certificate and update channel decisions in [#120][i120]. Until then an installer is unsigned, which the release notes must say. This is the one rule with no proof, and it blocks the first public release (4.10).
- **Platform coverage of the whole suite.** The terminal tests that need a POSIX shell are skipped on Windows (`SP-10`), so `SEC-05` and `SEC-03` for the terminal have no Windows proof beyond the unit tests.
- **The shared workflow's internals.** The pin fixes which version of `pr-checks` runs, but what it runs (Semgrep rules, the CodeQL query set) is owned by the Nano Collective's infrastructure repository and is not reviewed here.

[i120]: https://github.com/Nano-Collective/docs/issues/120
