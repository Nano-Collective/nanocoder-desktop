# Model and mode controls

Phase 1.9 implements `CHAT-04`, `CHAT-10`, `CHAT-11`, `CHAT-17`, `ACP-13`
and `ACP-14`. This foundation is not yet composed into the running application.
`DEC-31` remains Proposed, and implementation does not approve it.

## Shared-authority merge note

The controls service takes the **same injected `createProjectOperations`
instance** as ThreadService preparation, resume, prompts, cancellation and
permission settlement. It never constructs an authority, adds a project mutex
or re-enters a public operation from an owned helper.

ThreadService constructs and exposes the single authority. Controls also take
its `runProjectOperation` wrapper so attachment cancellation, operation activity
and shutdown settlement include their mutations. Passing separate instances is
not a valid integration, even if isolated tests pass. The common ancestor
includes checkpoints `274b216` and `24869fb`.

Phase 1.9 adds the minimal application wiring. Lane A's later phase 1.8 lifecycle
composition must preserve that wiring, its recovery-aware connection getter,
all four owned hooks, and project/exact-thread invalidation and disposal. Do not
replace it with an independent authority or a renderer live-mode cache.

The owned session context is `{lease, thread, connection, session, source}`,
where source is `new` or `resume`. The handoff follows safe mode acknowledgement
and saved session identity, inside `runOwnedStep`. Main reads bounded offers from
that exact bound connection, never a transcript or a renderer-supplied session ID.

## Current foundations

- `control-options.ts` projects only known provider/model string selects and the
  five known modes. Malformed, grouped, duplicate, excessive or accessor-backed
  offers fail closed. Unknown config IDs never become renderer capabilities.
- `session-controls.ts` retains process-current config options and session mode
  offers. Config success uses Nanocoder's actual response, including a different
  model chosen by a provider switch. A failed config response can follow an
  upstream partial change, so every prompt stays blocked until a replacement
  connection. It never retries or invents a rollback.
- `acp-client.ts` exposes main-only `getSessionOffers`, `setConfigOption` and
  `setMode`. Unknown or unoffered modes never reach Nanocoder's fallback. A live
  mode change removes prompt readiness until acknowledgement.
- `controls/project-controls.ts` owns opaque offer revisions. Config mutation
  reserves the injected authority before asynchronous native-root checks, then
  rechecks the exact current offer and revision. Any project operation, including
  an invalidated owner still settling, causes `BUSY` with no config RPC.
- `controls/thread-modes.ts` holds pending and acknowledged modes only in main
  memory, bound to the thread, canonical root, lease epoch and connection. It
  never writes yolo to SQLite. Native yolo consent defaults to cancellation and
  accepts only the explicit native response.
- `controls/workspace-controls.ts` shares the existing authority and wires
  safe-session observation, first-prompt pending-choice consumption and live
  presentation. Its preparation guard blocks every later prompt after uncertain
  config mutation, before any user content enters the transient prefix.
- Supervisor control events use the existing project metadata sequence, never
  the independent turn sequence. The renderer's mode action uses its existing
  guarded metadata update path, never an optimistic live-mode cache.
- The strict IPC/preload contract adds only `projects:get-controls` and
  `projects:set-config-option`. Without a composed service both fail closed.
- The plain-props composer and renderer controller keep drafts and confirmed
  values, explain disabled controls, distinguish pending modes, support a
  multiline input and show context only from reported data. They are not yet
  mounted in the application.

## Integration still required

Compose the tested services and native confirmation into the application, wire
the explicit non-yolo project-default action and mount the renderer controls.
No control action may create a session before the first send. SQLite must never
store live yolo or its authorisation.

The owned integration tests use real ThreadService, SQLite and a fake ACP
subprocess. They verify pending yolo causes no launch, safe acknowledgement and
saved identity precede yolo and prompt, another thread supplies project-wide
offers, provider changes use the confirmed model, and uncertain config changes
block repeated prompts before content.

Run the full repository, coverage, pinned ACP and built-app gates after
composition. Focused foundation tests and type checks do not substitute for
those gates or visual/accessibility QA.

The foundation checkpoint passes `pnpm test:all` with 921 unit tests. Application
composition, phase 1.9 built-app/ACP coverage and visual QA are still pending.
