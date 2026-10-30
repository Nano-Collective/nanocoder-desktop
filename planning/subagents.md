# Subagent projection and integration

- Status: Implemented projection, pending persistence composition
- Last updated: 2026-10-29

Phase 1.10 and U.7 render what Nanocoder `fc01e239a80ddb2e09ca174e3c909508832d5340` actually reports. The requirement and source map is [subagents](features/subagents.md). Visual decisions remain in [`DESIGN.md`](../DESIGN.md).

## Display boundary

`subagent-display.ts` attaches an optional display descriptor to the existing `toTurnEvent` result, without a second parser, listener, sequencer or route. A `think` call with an own, bounded `subagent_type` data property is recognised, as is a thin call titled exactly `agent` with absent or `think` kind. Arbitrary thinking tools remain ordinary tools. Unsupported or missing initial metadata therefore degrades to a plain tool row, not a guessed run.

Role, description and progress labels are escaped text, bounded by UTF-8 bytes, and reject control/format characters. No getter or inherited role property is read. Task prompts are not card labels. Title-only updates retain the initial descriptor, kind and details through the existing transcript reducer. Tool IDs are scoped after the latest user boundary. Pending progress cannot revive terminal tools or a settled delegation.

Cards report the root call state and literal title progress. They explicitly say depth, elapsed time and child details are unavailable. The depth-2/batch-5 source bounds are information, not editable settings or a live concurrency count. There is no fabricated tree or child session link. SDK child rows are passive fallback cards. Replayed calls say historical outcome is not reported, even if the synthetic packet says completed.

## Approval and stop ownership

The existing PermissionBroker and approval queue remain authoritative. The bounded `subagent:` hint and title label are display only. Answers still use the opaque main-owned request ID and an exact offered option ID. No inferred child or parent ID participates. The queue explains that the parent run is not reported and an approved tool can still fail. Inner completed announcements mean approved, not successful execution.

Every live unfinished root card calls the same whole-turn cancellation callback as the composer. The accessible name explicitly includes the entire turn and all subagents. All card stops share one pending guard, capture the clicked callback synchronously, recover from rejection with one alert, and disable while the owner is cancelling. Historical, terminal and unlinked SDK cards have no stop.

`settleSubagentTurn` seals unfinished live cards with the known turn outcome. Interrupted and failed outcomes survive a later user turn; a completed turn without a root result stays unknown. The App calls it after flushing the stream and checking process generation. Thread composition must call the same helper on its mapped terminal path, or provide the equivalent per-item outcome, rather than only passing the latest thread outcome.

## SUB-05 remains pending

`store/agent-runs.ts` uses the existing migration-001 table and accepts only desktop run UUID, thread UUID, null parent/child IDs, a bounded role identifier and a status enum. Project/thread joins and save-time ownership prevent reassignment. Reads are bounded to 200 rows. No prompt, task text, output, approval label, ACP packet or stderr is stored. There is no new migration, renderer capability, DesktopStore composition or application write yet. The Electron test asserts the real application's table is empty after fake delegations.

`subagent-runs.ts` is a passive consumer, not a lifecycle owner. It accepts validated main-owned context with project, thread, session, turn, execution and tool-call identity, sequence, generation and explicit live/replay provenance. It refuses mismatched IDs, duplicate/stale sequence, scope reuse, removed/disposed owners, orphan updates and uncommitted replay. Synthetic replay cannot overwrite known failure/interruption with success. End-of-turn settlement marks unfinished work interrupted, failed or unknown, never inferred completed.

Phase 1.8 must provide these before composing the observer:

1. A stable main-owned execution UUID for each `(project, thread, session, turn, toolCallId)`, reused during replay and restart. Reused tool IDs in different turns must get different UUIDs. No names or prefix parsing.
2. Full replay staged and committed only after successful completion. The observer receives `replayCommitted` observations only after identity mapping is complete, with an epoch and truthful terminal evidence. Rollback, restart reconciliation and durable mapping are not implemented here.
3. Existing sequence and process-generation checks, stream flush before terminal/replay/approval/switch, and cleanup on removal, supersession and disposal. The observer's bookkeeping must be bounded or retired as the owner closes turns; its current maps are not a long-lived session cache.
4. A transaction/migration decision for durable mapping owned by phase 1.8. The six existing metadata columns cannot preserve turn/tool identity by themselves. Until then `SUB-05` stays unchecked.

The [phase 1.8 replay checkpoint](durable-replay.md) now composes the required
store repositories and atomic replay mapping in ThreadService, with safe
metadata committed before snapshot replacement. Its additive passive
`fork(repository)` clones every observer fence into independent staging
closures. Real COMMIT failures and stale/reentrant candidates cannot replace
the original observer. Existing lane C assertions remain unchanged.

This updates the historical uncomposed-module description above, not the
`SUB-05` completion boundary. ThreadService live allocation/terminal
production, complete app/child restart continuation, import/ambiguity
integration and renderer replay/flush gates remain pending. The passive
modules alone do not prove those behaviours. `SUB-08` and `OQ-03` remain open
until Nanocoder exposes stable child identity, relationships, results and
per-child cancellation.

## Verification and limits

AVA covers projection, title-only retention, terminal guards, safe labels, broker authority, metadata ownership and passive lifecycle refusals. Electron tests exercise fake progress, same-name approvals, no-approval cancellation, draft/focus return, stop-owner capture and failed-stop recovery. The real pinned ACP tests use a scripted provider and isolated configuration, exercise allow/deny/cancel, and wait on actual polling and permission events rather than fixed sleeps.

Fake-only browser QA uses `app://renderer/index.html`, isolated profile, both themes and 1240/1020/840px widths. Focused stop crops show the existing 2px outline and wrapping without horizontal overflow. Settled dark axe audits report no violations; light audits retain the designer-owned approval-title 3.88:1 and Allow-label 4.35:1 gaps. Glyph-only contrast checks are incomplete, not a clean AA claim. Reduced-motion behaviour is checked in Electron. VoiceOver, Windows and Linux have not been checked by this phase.
