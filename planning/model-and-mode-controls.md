# Model and mode controls

Phase 1.9 implements `CHAT-04`, `CHAT-10`, `CHAT-11`, `CHAT-17`, `ACP-13`
and `ACP-14`, with the U.5 composer mounted in the running application.
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
The recovery-aware connection getter comes from checkpoint `c8137b3`.

Phase 1.9 adds the minimal application wiring. Lane A's later phase 1.8 lifecycle
composition must preserve that wiring, its recovery-aware connection getter,
all four owned hooks, and project/exact-thread invalidation and disposal. Do not
replace it with an independent authority or a renderer live-mode cache.
The remaining legacy archive, remove, history-delete and cancellation paths
still need lane A's phase 1.8 ownership and settlement integration.

The owned session context is `{lease, thread, connection, session, source}`,
where source is `new` or `resume`. The handoff follows safe mode acknowledgement
and saved session identity, inside `runOwnedStep`. Main reads bounded offers from
that exact bound connection, never a transcript or a renderer-supplied session ID.

## Implemented controls

- `control-options.ts` projects only known provider/model string selects and the
  five known modes. Malformed, grouped, duplicate, excessive or accessor-backed
  offers fail closed. Unknown config IDs never become renderer capabilities.
- `session-controls.ts` retains process-current config options and session mode
  offers. Config success uses Nanocoder's actual response, including a different
  model chosen by a provider switch. A failed config response can follow an
  upstream partial change, so every prompt stays blocked until a replacement
  connection. It never retries or invents a rollback.
- Current ready sessions can refresh model options through unsolicited
  `config_option_update` notifications. The same main-only owner checks raw
  config with the existing bounds, before the SDK can strip malformed entries.
  Replayed, empty, foreign, replaced, deleted, forgotten, unready, closing,
  disposed or uncertain updates cannot change the cache. A ready session still
  owned by another thread can update the project-wide model.
  Changed offers rotate and push the project revision without another controls
  read. Notifications neither change pending modes nor clear config uncertainty.
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
  It also drops previous-epoch live acknowledgement before the prepared-session
  fast path, so direct authority invalidation forces a safe resume.
- Supervisor control events use the existing project metadata sequence, never
  the independent turn sequence. The renderer's mode action uses its existing
  guarded metadata update path, never an optimistic live-mode cache.
- The strict IPC/preload contract adds only `projects:get-controls` and
  `projects:set-config-option`. Without a composed service both fail closed.
- The plain-props composer and renderer controller keep drafts and confirmed
  values, explain disabled controls, distinguish pending modes, support a
  multiline input and show context only from reported data. The mounted input
  grows to 160px, supports Shift+Enter, ignores composing Enter and retains
  drafts during control changes and turns.

## Application composition

The IPC composition forwards all four ThreadService closures to the controls
runtime, then injects that service's authority, tracked operation wrapper and
recovery-aware `getControlConnection` getter. Existing mode/default requests and
the two additive controls requests use this runtime. Stop/restart, renderer
detach, project unavailability and exact-thread removal invalidate controls;
shutdown disposes them. No control action creates a session before first send.
SQLite never stores live yolo or its authorisation.

`use-project-controls.ts` owns the scoped renderer controller. Main remains the
source of confirmed modes, offers and defaults. The renderer neither prepares a
hidden session nor adds an authorisation cache.

The owned integration tests use real ThreadService, SQLite and a fake ACP
subprocess. They verify pending yolo causes no launch, safe acknowledgement and
saved identity precede yolo and prompt, another thread supplies project-wide
offers, provider changes use the confirmed model, and uncertain config changes
block repeated prompts before content. They also prove native confirmation
shares prompt admission, late consent is refused after invalidation, and a
previous-epoch yolo cannot survive a repeated-prompt fast path.
Cancelling a new yolo selection leaves any earlier pending choice untouched and
usable at first send. Replacement occurs only after acceptance and the existing
scope checks. A cancelled yolo can also be selected again and explicitly accepted.

## Verification and design deviation

- `pnpm test:all`: 954 unit tests; formatting, types, lint, Knip and audit pass.
- `pnpm test:ava:coverage`: 97.06% lines.
- `pnpm test:e2e`: 147 pass, including seven mounted controls/composer checks.
- Pinned ACP `fc01e239a80ddb2e09ca174e3c909508832d5340`: 20 pass,
  including real mode acknowledgement, provider-confirmed different model and
  resume retaining the process-current model rather than historical config.
  These low-level protocol tests bypass desktop discovery. The pinned CLI
  reported 1.31.0, below the then-current desktop minimum of 1.32.0. The later
  [provisional version policy](acp-integration.md#provisional-prototype-policy-phase-14)
  admits verified development overrides only, not published npm 1.31.0.
- Locked fake-app QA covers dark/light at 1240, 1020 and 840px, keyboard focus,
  project-wide accessible names, explicit default, cancel-default yolo and
  readable drafts with disabled controls during an approval-held turn.
  Native dialog defaults and explicit acceptance are covered through the main
  helper and built-app dialog stub, not an OS-native screenshot.

The approved U.5 deviation dims only disabled interactive controls using the
single `.composer .composer-inactive-control:disabled` rule. Static reasons and
labels remain full opacity, rather than dimming the whole form as DESIGN prose
suggests. A focused both-theme rendered-contrast test uses the unchanged QA
probe; inactive control text itself is contrast-exempt. DESIGN and generated
tokens are unchanged. Existing documented design contrast gaps remain, so this
is not a claim of whole-application AA.

Fixture-only logs and screenshots live under `.qa/wave-4/`. The foundation
checkpoint `73bb4ef` passed 921 unit tests before application composition.
