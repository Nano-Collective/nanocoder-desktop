# Subagent projection and integration

- Status: Implemented projection, pending persistence composition
- Last updated: 2026-10-30

Phase 1.10 and U.7 render what Nanocoder `fc01e239a80ddb2e09ca174e3c909508832d5340` actually reports. The requirement and source map is [subagents](features/subagents.md). Visual decisions remain in [`DESIGN.md`](../DESIGN.md).

## Display boundary

`subagent-display.ts` attaches an optional display descriptor to the existing `toTurnEvent` result, without a second parser, listener, sequencer or route. A `think` call with an own, bounded `subagent_type` data property is recognised, as is a thin call titled exactly `agent` with absent or `think` kind. Arbitrary thinking tools remain ordinary tools. Unsupported or missing initial metadata therefore degrades to a plain tool row, not a guessed run.

Role, description and progress labels are escaped text, bounded by UTF-8 bytes, and reject control/format characters. No getter or inherited role property is read. Task prompts are not card labels. Title-only updates retain the initial descriptor, kind and details through the existing transcript reducer. Tool IDs are scoped after the latest user boundary. Pending progress cannot revive terminal tools or a settled delegation.

Cards report the root call state and literal title progress. They explicitly say depth, elapsed time and child details are unavailable. The depth-2/batch-5 source bounds are information, not editable settings or a live concurrency count. The card does not show them. There is no fabricated tree or child session link. SDK child rows are passive fallback cards. Replayed calls say historical outcome is not reported, even if the synthetic packet says completed.

## Approval and stop ownership

The existing PermissionBroker and approval queue remain authoritative. The bounded `subagent:` hint and title label are display only. Answers still use the opaque main-owned request ID and an exact offered option ID. No inferred child or parent ID participates. The queue explains that the parent run is not reported and an approved tool can still fail. Inner completed announcements mean approved, not successful execution.

Every live unfinished root card calls the same whole-turn cancellation callback as the composer. The accessible name explicitly includes the entire turn and all subagents. All card stops share one pending guard, capture the clicked callback synchronously, recover from rejection with one alert, and disable while the owner is cancelling. Historical, terminal and unlinked SDK cards have no stop.

A sealed card never regains a stop while a later turn awaits its batched user boundary. Its old control cannot cancel the later turn. Adding cards keeps existing card nodes mounted. When a focused stop disappears, focus moves to that same named card with `tabindex=-1`, never into the tab order or onto a newly added run. Successful user cancellation keeps the composer's existing focus return. Other controls and approval focus taking/returning are unchanged (`A11Y-01`, `A11Y-02`).

`settleSubagentTurn` seals unfinished live cards with the known turn outcome. Interrupted and failed outcomes survive a later user turn; a completed turn without a root result stays unknown. The App calls it after flushing the stream and checking process generation. Thread composition must call the same helper on its mapped terminal path, or provide the equivalent per-item outcome, rather than only passing the latest thread outcome.

## SUB-05 remains pending

`store/agent-runs.ts` uses the existing migration-001 table and accepts only desktop run UUID, thread UUID, null parent/child IDs, a bounded role identifier and a status enum. Project/thread joins and save-time ownership prevent reassignment. Reads are bounded to 200 rows. No prompt, task text, output, approval label, ACP packet or stderr is stored. Phase 1.8 adds migration 004 for structural turn/execution identities, composes the repositories in DesktopStore and owns atomic live/replay application writes in ThreadService. No renderer capability is added. The composed Electron tests check exact safe run rows and identity joins after fake delegations.

`subagent-runs.ts` is a passive consumer, not a lifecycle owner. It accepts validated main-owned context with project, thread, session, turn, execution and tool-call identity, sequence, generation and explicit live/replay provenance. It refuses mismatched IDs, duplicate/stale sequence, scope reuse, removed/disposed owners, orphan updates and uncommitted replay. Synthetic replay cannot overwrite known failure/interruption with success. End-of-turn settlement marks unfinished work interrupted, failed or unknown, never inferred completed.

The phase 1.8 composition now provides these boundaries:

1. A stable main-owned execution UUID for each `(project, thread, session, turn, toolCallId)`, reused during replay and restart. Reused tool IDs in different turns must get different UUIDs. No names or prefix parsing.
2. Full replay staged and committed only after successful completion. The observer receives `replayCommitted` observations only after identity mapping is complete, with an epoch and truthful terminal evidence. ThreadService and the store own rollback, restart reconciliation and durable mapping, not the passive consumer.
3. Existing sequence and process-generation checks, stream flush before terminal/replay/approval/switch, and cleanup on removal, supersession and disposal. The observer's bookkeeping must be bounded or retired as the owner closes turns; its current maps are not a long-lived session cache.
4. Migration 004 and one identity/run transaction owned by phase 1.8. The six existing metadata columns do not preserve turn/tool identity by themselves. `SUB-05` stays unchecked until independent full integration acceptance.

The [phase 1.8 replay checkpoint](durable-replay.md) now composes the required
store repositories and atomic replay mapping in ThreadService, with safe
metadata committed before snapshot replacement. Its additive passive
`fork(repository)` clones every observer fence into independent staging
closures. Real COMMIT failures and stale/reentrant candidates cannot replace
the original observer. Existing lane C assertions remain unchanged.

ThreadService also composes live allocation and owning terminal production
through `commitLive` and the existing fork. Identity and safe run metadata
commit before their user/tool batch is published. Approval-only completion
is not success; later turns may reuse a tool ID but not its execution UUID.
Existing passive unit/renderer assertions are not weakened.
The optional main-owned historical outcome travels through an enum-only
transcript field and one existing card prop. Known failed/interrupted cards
retain their glyph and existing error token; missing/unknown stays muted.
Previously reported completion is not styled as historical success. A built
whole-app/child restart proof checks UUID reuse, retained failure, synthetic
unknown outcome and no duplicate cards with the same temporary profile.

The branch also implements bounded replay and opaque renderer readiness gates,
plus exact-root discovery and explicit metadata-only import. Source, both-theme
built tests and pinned real-ACP checks cover their scoped refusals and
continuation boundaries, as described in [durable replay](durable-replay.md).
Complete app/child restart continuation with a real model session and
independent full phase 1.8/SUB-05 acceptance remain pending. The passive
modules alone do not prove those behaviours. `SUB-08` and `OQ-03` remain open
until Nanocoder exposes stable child identity, relationships, results and
per-child cancellation.

## Verification and limits

AVA covers projection, title-only retention, terminal guards, safe labels, broker authority, metadata ownership and passive lifecycle refusals. Electron tests exercise fake progress, same-name approvals, no-approval cancellation, draft/focus return, stop-owner capture and failed-stop recovery. The real pinned ACP tests use a scripted provider and isolated configuration, exercise allow/deny/cancel, and wait on actual polling and permission events rather than fixed sleeps.

Fake-only browser QA uses `app://renderer/index.html`, isolated profile, both themes and 1240/1020/840px widths. Focused stop crops show the existing 2px outline and wrapping without horizontal overflow. Settled dark axe audits report no violations; light audits retain the designer-owned approval-title 3.88:1 and Allow-label 4.35:1 gaps. Glyph-only contrast checks are incomplete, not a clean AA claim. Reduced-motion behaviour is checked in Electron. VoiceOver, Windows and Linux have not been checked by this phase.
