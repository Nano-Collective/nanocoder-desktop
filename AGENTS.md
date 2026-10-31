# AGENTS.md

Guidance for coding agents, and anyone else, working in this repository. Keep it current: a pull request that changes the structure, commands or conventions below updates this file too.

## Project Overview

Nanocoder Desktop is an Electron desktop workspace around [Nanocoder](https://github.com/Nano-Collective/nanocoder). It drives Nanocoder over the Agent Client Protocol (`nanocoder --acp`) and adds no agent of its own: Nanocoder owns models, prompts, tools, approvals and chat history.

The project is pre-v0.1. The plan lives in [`planning/`](planning/index.md): start at `planning/index.md`, and see `planning/roadmap.md` for the current phase. How the app looks is in [`DESIGN.md`](DESIGN.md).

## Architecture

| Layer | Folder | Rule |
|---|---|---|
| Main process | `source/main/` | The only privileged code: windows, the `app://` protocol, session lock-down, IPC handlers, finding and launching Nanocoder |
| Preload | `source/preload/` | Sandboxed, built as CommonJS. Exposes typed functions as `window.desktop`, never `ipcRenderer` |
| Renderer | `source/renderer/` | React, sandboxed, no Node. Receives data, never a capability |
| Shared | `source/shared/` | IPC channel names, error codes, result and data types |

Details are in [`planning/architecture.md`](planning/architecture.md); the security rules are in [`planning/security.md`](planning/security.md).

## Key Files

| Path | Purpose |
|---|---|
| `source/main/index.ts` | App entry: profile ownership lock, `app://` protocol, CSP, sandbox, navigation and window rules |
| `source/main/lifecycle.ts` | Ready-gated, shutdown-stopped window requests, service disposal and quit guard; supervisor cleanup finishes before the store closes |
| `source/main/security.ts` | Origin checks, renderer file resolution, Content Security Policy |
| `source/main/paths.ts` | Shared native realpath canonicalisation (symlinks and volume case aliases) and component containment |
| `source/main/ipc/handle-request.ts` | Sender check, schema validation and the result shape for every IPC call |
| `source/main/ipc/index.ts` | Registers the IPC handlers |
| `source/main/ipc/workspace.ts` | Strict workspace request schemas and injectable handlers; absent services return `UNAVAILABLE` |
| `source/main/ipc/workspace-services.ts` | Main-only project and thread service contracts |
| `source/main/projects/` | Canonical project selection and relocation, bounded read-only trust summaries, and snapshot-checked native consent |
| `source/main/store/contracts.ts` | Metadata store, repositories and replaceable SQLite driver seam (`DEC-04`) |
| `source/main/store/index.ts` | Opens `userData/desktop.sqlite`, checks integrity, quarantines corruption and stores validated settings/UI state |
| `source/main/store/node-sqlite.ts` | `node:sqlite` adapter and online backup; library errors never expose SQL inputs |
| `source/main/store/migrations/` | Numbered, transactional schema upgrades, with a backup before upgrading an existing database |
| `source/main/store/migrations/003-manual-thread-titles.ts` | Main-only boolean for durable manual-title precedence; existing titles are conservatively protected (`CHAT-12`) |
| `source/main/store/migrations/004-thread-execution-identities.ts`, `source/main/store/thread-execution-identities.ts` | Main-only bounded structural turn/execution identities, revision guards and atomic safe run metadata commits |
| `source/main/store/repositories.ts` | Project/thread metadata only, scoped queries, canonical paths and cascade removal |
| `source/main/store/validation.ts` | Allowlisted metadata schemas, including the settings/UI patches shared with IPC |
| `source/main/nanocoder/supervisor-contracts.ts` | Main-only per-project supervisor interface |
| `source/main/nanocoder/supervisor.ts` | Canonical-root process ownership, bounded recovery, injected idle activity and awaited shutdown |
| `source/main/nanocoder/clock.ts`, `source/main/nanocoder/fixtures/fake-clock.ts` | Cancellable supervisor timers and deterministic recovery/idle tests |
| `source/main/nanocoder/diagnostics.ts` | Payload-filtered immutable captures, expiry and exact main-owned review/export |
| `source/main/nanocoder/version-policy.ts` | Provisional minimum version, fail-closed parsing and untested-version warnings (`ACP-04`, `OQ-02`) |
| `source/main/nanocoder/abort.ts` | Cancels pending lookups and trust confirmations without allowing late launches |
| `source/main/nanocoder/runtime.ts` | Finds Nanocoder and a Node.js runtime by absolute path |
| `source/main/nanocoder/launch.ts` | Starts Nanocoder with an argument array and no shell |
| `source/main/nanocoder/acp-client.ts` | Starts `nanocoder --acp` in the project root, sends `initialize`, and opens or resumes sessions with their mode set |
| `source/main/nanocoder/session-title.ts` | Bounded, allowlisted parsing for main-only Nanocoder title notifications |
| `source/main/threads/session-discovery.ts`, `source/main/nanocoder/session-discovery.acp.ts` | Bounded native exact-root saved-session discovery and pinned real-ACP listing/resume proof (`ACP-18`, `DEC-34`) |
| `source/main/threads/thread-service.ts` | Metadata-first threads, mapped transient events, main-only activity/recovery/detach adapters and separately confirmed history deletion |
| `source/main/threads/project-operations.ts`, `planning/project-operations.md` | Shared branded execution/metadata/confirmation leases, owned thread mutations, active-turn exceptions and preparation/recovery/detach settlement barriers |
| `source/main/controls/`, `planning/model-and-mode-controls.md` | Shared-authority model offers, memory-only pending/live modes, cancel-default native yolo consent and owned hooks; preserve their wiring in phase 1.8 composition |
| `source/main/nanocoder/control-options.ts`, `source/main/nanocoder/session-controls.ts` | Bounded known offers, acknowledgement-gated modes and process-wide config uncertainty |
| `source/main/nanocoder/trust.ts` | Reads Nanocoder's trust refusals and runs the short trust launch (`DEC-30`) |
| `source/main/nanocoder/trust-preflight.ts` | Isolated fail-closed ACP trust-check admission for provisional 1.31.x overrides, with identity-keyed memory-only verdicts |
| `source/main/nanocoder/open-project.ts` | Connects, asks before trusting a folder, then opens or resumes a session in the starting mode |
| `source/main/nanocoder/protocol-stream.ts` | Reads stdout as ACP only; anything else ends the connection |
| `source/main/nanocoder/stderr-ring.ts` | Bounded, redacted, in-memory ring for Nanocoder's stderr |
| `source/main/nanocoder/permissions.ts` | Holds each permission request until the user answers; only an option Nanocoder offered counts |
| `source/main/nanocoder/turn-events.ts`, `source/main/nanocoder/turn-metadata.ts` | Normalises SDK stream updates and allowlisted vendor metadata without adding capabilities |
| `source/main/nanocoder/subagent-display.ts`, `source/shared/subagents.ts` | Bounded display-only delegation and permission source hints, never routing or answer authority |
| `source/main/store/agent-runs.ts`, `source/main/nanocoder/subagent-runs.ts` | Metadata-only repository and forkable passive observer; ThreadService owns atomic live/replay association |
| `source/main/threads/thread-history-observer.ts` | Scoped atomic live/replay observation, disposable staging, strict slot/epoch guards and post-commit-only observer activation |
| `source/main/threads/thread-history-mapping.ts`, `source/main/threads/thread-live-mapping.ts`, `source/main/threads/thread-sequence.ts`, `planning/durable-replay.md` | Structural replay and live identities through one main-only batch allocator, bounded session replay and opaque readiness gates |
| `source/renderer/transcript.ts`, `source/renderer/stream-batcher.ts` | Ordered immutable transcript patches and cancellable 16ms renderer batching |
| `source/renderer/conversation-stream.tsx`, `source/renderer/agent-markdown.tsx`, `source/renderer/stream-commands.tsx` | U.4 stream rows, isolated inert Markdown and advertised-command draft suggestions |
| `source/renderer/stream-announcements.tsx` | A11Y-04/05 clock-injected lifecycle/finished-response speech and one persistent modal-aware polite live node |
| `source/renderer/composer.tsx`, `source/renderer/project-controls.ts`, `source/renderer/use-project-controls.ts` | Mounted multiline composer, native mode/default disclosure and scoped acknowledged project-control state; no renderer live-mode cache |
| `source/shared/control-reasons.ts` | Shared refusal copy for irreversible same-process config uncertainty |
| `planning/streaming-conversation.md` | Phase 1.6 stream semantics, metadata boundaries, performance and remaining integration seams |
| `source/renderer/subagent-run-card.tsx`, `source/renderer/styles/subagents.css` | U.7 flat reported progress, truthful fallback and the owner's whole-turn stop callback |
| `planning/subagents.md` | Phase 1.10 source limits, SUB-05 composition contract and subagent verification gaps |
| `source/renderer/recovery-tools.tsx` | Compact process recovery and captured diagnostics review/export controls |
| `source/renderer/app-shell.tsx`, `source/renderer/styles/app-shell.css` | Compact chronological navigation, constrained chat and optional workbench/bottom slots; open workbench owns the canvas at 840px and below |
| `source/renderer/thread-rail.tsx`, `source/renderer/thread-rail-model.ts` | Plain-prop U.3 chronological groups, state glyphs and metadata actions; presentation uses `styles/threads.css` |
| `source/renderer/thread-recovery-notice.tsx` | Plain-prop CHAT-09 missing-history metadata/actions and explicit same-thread retry; view-only keeps the composer hidden |
| `source/renderer/thread-composer-state.ts` | App-only draft visibility/editability projection; runState, not reason presence, distinguishes retryable and view-only |
| `source/renderer/session-import-controller.ts`, `source/renderer/use-session-imports.ts`, `source/renderer/session-import-list.tsx` | Separately scoped metadata-only import offers, stale-result guards and plain-props native actions; no automatic selection or prompt |
| `source/renderer/thread-palette.ts` | New, rename and archive palette commands sharing the rail's callbacks and refusal policy |
| `source/renderer/thread-controller.ts` | Scoped thread metadata, snapshot/open bridge calls, isolated project/chat sequences and stale async/disposal guards |
| `source/renderer/thread-stream.ts` | Per-thread transient sequence guards, snapshot-prefix replacement and buffered live delivery; separate from project metadata sequencing |
| `source/renderer/thread-workspace.ts`, `source/renderer/use-threads.ts`, `source/renderer/thread-conversations.ts` | Live scoped workspace composition, memory-only drafts and authoritative transient terminal prefixes |
| `planning/threads.md` | Phase 1.5 ownership, legacy protection twins, selected-glyph accessibility deviation and deferred resume work |
| `source/renderer/supervisor-state.ts` | Project-scoped, sequenced ACP badge state; never infers readiness from a connect result |
| `source/renderer/approval-requests.tsx` | U.6 plain-prop composer-shelf approval cards, request-scoped shortcuts and queued focus return |
| `source/renderer/ui.tsx`, `source/renderer/styles/` | Shared UI parts, local Fira Code, generated tokens and technical-gate styles |
| `source/renderer/recent-projects.tsx`, `source/renderer/trust-feedback.tsx`, `source/renderer/project-refresh.ts` | Plain-prop project controls, trust feedback and sequenced recents refresh; `use-projects.ts` owns bridge calls and read-generation guards |
| `source/shared/project-events.ts` | Strict ID/sequence-only recents invalidation schema and preload event-variant filter; no new IPC method or channel |
| `scripts/generate-design-tokens.mjs` | Generates committed CSS custom properties from `DESIGN.md`; the adjacent spec rejects drift |
| `planning/ui-foundations.md` | Theme switching, keyboard-focus QA and the proposed Markdown renderer |
| `planning/projects-and-trust.md` | Project opening, safe summary limits, the pre-trust probe exception and remaining Nanocoder trust gaps |
| `planning/app-shell.md` | Shell composition, supervisor badge rules and locked multi-width QA |
| `source/renderer/overlays.tsx`, `source/renderer/overlay-model.ts` | U.12 renderer-only command palette, shortcuts, focus return and clock-injected toast queue |
| `planning/ui-overlays.md` | Overlay commands, keyboard rules and notification verification |
| `THIRD-PARTY-NOTICES.txt` | Bundled font OFL 1.1 and Markdown dependency copyright/licence notices |
| `source/main/nanocoder/capabilities.ts` | Records `initialize` capabilities and builds feature gates with reasons; extensions need safe probes |
| `source/main/nanocoder/fixtures/` | A fake `nanocoder --acp`, a scripted model provider and test helpers, including the setup shared by the `*.acp.ts` tests |
| `source/shared/ipc.ts` | Channels, error codes and IPC types |
| `source/shared/thread-replay.ts` | Strict optional display-only replay markers and readiness refusal copy; epochs never enter a request or authorise an action |
| `source/preload/index.ts` | The `window.desktop` bridge |
| `e2e/*.e2e.ts` | Playwright tests against the built app |
| `e2e/store.e2e.ts` | Built-main persistence, migration backup, corruption recovery and storage refusal tests |
| `e2e/projects.e2e.ts` | Isolated-profile project persistence, native trust, recents, relocation and trust-revocation tests |
| `e2e/supervisor.e2e.ts` | Built-main quit while a child is still initialising, including child-exit verification |
| `e2e/supervisor-recovery.e2e.ts` | Crash/retry, saved-history replay, both-theme CHAT-09 keyboard/native recovery actions, crash-loop limits and reviewed diagnostics refusals |
| `e2e/streaming.e2e.ts` | Fake stream cadence, ordered rendering, input/scroll/frame response, safe resources and multi-width stream QA |
| `e2e/replay-gates.e2e.ts` | Mounted replay success/failure refusals, editable unqueued drafts and 200-message post-replay usability timing (`PERF-03`) |
| `e2e/session-import.e2e.ts` | Both-theme keyboard saved-session import, no ACP/selection/draft side effects, explicit same-session resume and project ownership |
| `e2e/session-import-focus.e2e.ts`, `e2e/qa/session-import-focus-harness.ts` | Mounted pending-import composer/scope focus guards and preserved keyboard-only return in both themes |
| `e2e/stream-announcements.e2e.ts`, `e2e/qa/stream-announcement-harness.ts` | Isolated fake-clock speech, accessibility-tree/modal-host checks and lifecycle/approval focus checks |
| `e2e/subagents.e2e.ts`, `e2e/qa/subagent-harness.ts` | Fake delegation/approval/cancel, card focus and stop-owner/refusal tests; `subagents.acp.ts` checks real pinned ACP |
| `e2e/qa/launch.ts` | Test-only launcher for browser-driven QA with fake Nanocoder and a separate profile in `.qa/` |
| `e2e/qa/approval-harness.ts` | Browser-only component fixture for failed answers and atomic same-size approval queue replacement |
| `e2e/qa/ui-contrast.ts` | Token-pair and rendered-text contrast checks, with a co-located AVA spec |
| `scripts/node-sidecar.json` | The pinned Node sidecar: exact version and SHA-256 per platform (`DEC-38`) |
| `scripts/fetch-node-sidecar.mjs`, `scripts/measure-runtime.mjs` | Download and verify the sidecar; measure both runtimes (phase G.6) |
| `electron.vite.config.ts`, `electron-builder.yml` | Build and packaging |
| `.github/workflows/desktop-checks.yml` | Local CI jobs beside the shared `pr-checks` |

## Development Commands

```bash
pnpm install
pnpm dev               # run the app, rebuilding on change
pnpm qa:launch         # launch the already-built app with fake Nanocoder and localhost CDP on 9333
pnpm test:all          # the gate: format, types, lint, unit tests, Knip, audit
pnpm test:ava          # unit tests
pnpm test:e2e          # build, then Playwright (use xvfb-run on headless Linux)
pnpm test:acp          # ACP integration tests (*.acp.ts), needs NANOCODER_CLI
pnpm package:dir       # unpacked app for this platform in release/
pnpm fetch:node        # download the pinned Node sidecar into .cache/, checked against its pinned SHA-256
pnpm measure:runtime   # Phase G.6: startup and memory under Electron's Node mode and the sidecar (needs NANOCODER_CLI)
pnpm format            # apply Biome formatting
pnpm tokens:generate   # regenerate committed CSS variables from DESIGN.md
pnpm changeset         # add a changeset for a user-facing change
```

`NANOCODER_DESKTOP_CLI` and `NANOCODER_DESKTOP_NODE` point the app at a specific Nanocoder `dist/cli.js` and Node.js runtime (absolute paths).

## Security Rules

These hold in every change:

- Renderers stay sandboxed with context isolation and no Node. The preload exposes typed functions only.
- Every IPC handler goes through `registerHandler`, with a `zod` `strictObject` schema. It returns an `IpcResult`; throw `IpcFailure` for a specific error code.
- Processes start from an absolute path with an argument array and `shell: false`. No `PATH` lookup at launch, and never a binary from the project's own folder.
- Nanocoder's stdout carries ACP only: a line that is not a JSON-RPC frame ends the connection. Its stderr is redacted into a bounded in-memory ring, and only Nanocoder's own `[nanocoder]` message reaches the UI.
- Nanocoder's directory trust is recorded only by the trust launch right after the user confirms (`DEC-30`). No `--trust-directory`, no `NANOCODER_TRUST_DIRECTORY` on any other launch, and an inherited one is dropped.
- Permission requests are answered only by the user, from the main process: the renderer sends a request id and an option id, and both are checked against what Nanocoder offered. With no handler, a request is answered as cancelled, never allowed (`ACP-10`).
- Every Nanocoder session gets its mode with `session/set_mode` before its first prompt, checked against `availableModes`. A thread takes no prompt until that succeeds, and `yolo` is never restored (`DEC-31`).
- Paths are canonicalised and checked to stay inside their root before use.
- Chat messages, file contents, tool results and secrets are never written to disk or logs. Redacted stderr stays in memory unless the user reviews that exact captured snapshot in main and chooses an export destination.
- The app renderer loads nothing remote and keeps its strict Content Security Policy.

## Code Style Guidelines

- Biome formats and lints (tabs, single quotes, 80 columns). Run `pnpm format`.
- Strict TypeScript. Import from `source/` through the `@/` alias.
- Comments are rare: one line, only where the reason is not obvious.
- Docs and UI text follow the [Brand Guidelines](https://docs.nanocollective.org/collective/organisation/brand): British spelling, no em dashes in docs, no marketing language.
- Ownership is the Nano Collective core team; docs name no individual owner.

## Testing

- Unit tests are AVA `.spec.ts` files beside the code, run in plain Node. Keep logic in modules that do not import Electron, so it can be tested.
- A security rule needs a test that proves the refusal, not only the happy path.
- Tests never sleep for a fixed time; they wait for an event.
- End-to-end tests live in `e2e/`. ACP integration tests are `*.acp.ts`; they keep Nanocoder's config in a temporary folder, use a scripted model provider (no API key) and need a Nanocoder build with the ACP trust check.
- Every end-to-end and QA launch uses `e2e/qa/electron.ts` and a temporary `--user-data-dir`. Routine tests stay hidden and never take native focus or show a macOS Dock icon. The development-only `--nanocoder-e2e-hidden` switch is ignored by packaged apps. CDP emulates page activation only; DOM focus, `:focus-visible`, keyboard input and focus-return assertions remain real. Use `NANOCODER_E2E_VISIBLE=1 pnpm test:e2e` or `NANOCODER_E2E_VISIBLE=1 pnpm qa:launch` only for deliberate native-focus or screen-reader QA.
- Coverage stays at or above 80% of lines.
- UI tokens are generated, not edited by hand. The root `data-theme="light"` switches to light; dark is the default. See `planning/ui-foundations.md` for theme, focus, reduced-motion and contrast QA.
- For visual QA, run `pnpm build`, then `pnpm qa:launch` and `agent-browser connect 9333`. The folder picker and trust dialog are stubbed only in the test launcher. Save fake-fixture screenshots and logs under `.qa/`, never real conversation content. Stop the printed launcher PID when finished. The launcher is type-checked by `tsconfig.e2e.json`, discovered by Knip through the package script and excluded from packaging.

## AI Coding Assistance Notes

- Before changing behaviour, read `planning/index.md`, the relevant file in `planning/features/` and `planning/decisions.md`. A change to a decision updates `planning/decisions.md` in the same pull request.
- Work one roadmap phase at a time and cite its requirement IDs (for example `ACP-01`).
- Commit messages follow the NC convention: `feat:`, `fix:`, `mod:`, `chore:`, `docs:`, lowercase, imperative, no trailing full stop.
- `DESIGN.md` belongs to the designer. Do not change its visual decisions.
- Run `pnpm test:all` before finishing.

## Repository

- GitHub: [Nano-Collective/nanocoder-desktop](https://github.com/Nano-Collective/nanocoder-desktop)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Licence: MIT
