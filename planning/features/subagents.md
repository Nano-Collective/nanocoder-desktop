# Subagents

How the desktop shows, approves and stops bounded Nanocoder subagents.

- Status: Draft
- Last updated: 2026-10-29
- Drafted by: @akramcodez

## Purpose

Let the user delegate a bounded subtask, follow each child agent, and stop it when needed ([whitepaper, v1 scope][wp-scope] item 3, `SP-05`). Nanocoder owns delegation; the desktop renders it. Visual design: see [`DESIGN.md`](../../DESIGN.md).

## What Nanocoder exposes at `fc01e239`

- **Bounds.** Executor depth limit 2 and concurrency limit 5 ([source][nc-limits]); the interactive batch guard also caps a batch at 5. The ACP tool loop awaits calls sequentially ([source][nc-loop]). These constants are not an advertised active-child count or desktop settings.
- **Projection.** A subagent run is the parent's `agent` tool call. Its `think` kind is not unique. The initial call can include `subagent_type` and `description`; updates can contain only the title. While it runs, Nanocoder polls progress every 1.5 seconds and updates the same tool-call title with the subagent name, token count and last tool ([source][nc-poll]). There is no child session ID, parent-child link, actual depth, elapsed time or `agent_run` event. The polling choice is heuristic, so the title is reported text, not a reliable child identity.
- **Approvals.** Tools that need approval arrive as `session/request_permission` with IDs prefixed `subagent:` and a name suffix in the title. Nanocoder marks them completed immediately after approval, before execution; the execution result is not reported ([source][nc-approval]). Whether a request is needed depends on Nanocoder's mode and shared `alwaysAllow` policy ([source][nc-policy]), not a desktop guarantee that every child tool asks. One approval handler is shared by a turn, so the one-root-turn rule remains necessary.
- **Cancellation.** Only the whole turn (`session/cancel`).
- **Replay.** Synthetic history tool calls use the function name and completed status, without proving the original outcome ([source][nc-replay]). A replayed completed card must not be presented as a known success.

Results flowing back from subagent tools are tracked in [nanocoder#1105][nc1105]. The missing result remains observable in the pinned source; this implementation does not claim the issue is resolved.

## Phase 1.10 implementation

The supported projection is implemented as flat cards, one shared approval queue and whole-turn stop. Bounded display hints never route events or answer permissions. A name suffix cannot associate a request with one of two same-name runs, so requests explicitly say the parent run is not reported. Missing details fall back without inventing nesting or child controls.

`SUB-05` remains pending. A metadata-only repository and passive observer are tested but not composed into the application: phase 1.8 must supply stable main-owned turn/run identity and an atomic replay commit first. The application intentionally creates no `agent_run` rows yet. See [implementation and integration notes](../subagents.md).

## v1 requirements

| ID | Requirement | Status and source |
|---|---|---|
| SUB-01 | Render each `agent` tool call as a subagent run with its status from `tool_call` and `tool_call_update`. | Decided ([whitepaper, Open risks][wp-risks]: degrade to tool cards) |
| SUB-02 | Show Nanocoder's progress updates (name, tokens, tool count) as they arrive. | Suggestion (not discussed), based on [source][nc-poll] |
| SUB-03 | Show `subagent:` permission requests attributed to the subagent, and say that an approved subagent call may still fail afterwards. | Suggestion (not discussed), based on [docs][nc-acp-limits] |
| SUB-04 | "Stop" on a subagent cancels the whole turn and says so, until Nanocoder offers per-child cancel. | Suggestion (not discussed) |
| SUB-05 | Record an `agent_run` row per run (`DATA-02`). | Decided ([whitepaper ER diagram][wp-er]) |
| SUB-06 | Show Nanocoder's bounds as information; the desktop does not configure them. | Decided (bounds are Nanocoder's) |
| SUB-07 | When detailed child events are unavailable, fall back to ordinary tool cards without error. | Decided ([whitepaper, Open risks][wp-risks]) |
| SUB-08 | When Nanocoder exposes child IDs and events, show a parent-child run tree with per-child status and cancel. | Open (`OQ-03`) |

## What a run shows

| Field | Source today | Source after the Nanocoder change |
|---|---|---|
| Subagent name | Bounded initial role hint and the literal polled title, not an identity | A child event |
| Status | The parent `agent` tool call status | Per-child status |
| Progress | Token count, tool count and last tool, every 1.5 seconds | Child events as they happen |
| Approvals | One queue, bounded source label and explicit unknown parent | Same, routed by session |
| Result | The parent tool call result | Per-child result with real failure status |
| Stop | Whole turn | Per child |

## Proposed projection

Suggestion (not discussed), as input to the Nanocoder change in [`acp-integration.md`](../acp-integration.md#nanocoder-changes-needed): a `_nanocoder/subagent` notification (underscore-prefixed, as ACP requires for custom notifications) carrying the parent tool call ID, a child run ID, the subagent name, a status (`started`, `progress`, `completed`, `failed`, `cancelled`), and a per-child cancel extension method. Advertised under `_meta` in `agentCapabilities` so clients can detect it. This is the shape `SUB-08` would consume; Nanocoder maintainers decide the real one.

## Explicit deferrals

Unbounded orchestration, user-defined subagent creation in the desktop, parallel root agents.

## Edge cases and failure modes

- **Two threads with subagents at once.** Cannot happen in the desktop because of `CHAT-17`; it would misroute approvals in Nanocoder.
- **Stale progress.** Nanocoder ignores progress entries from earlier calls ([source][nc-poll]); the desktop shows only updates for the current tool call.
- **Approved, then failed.** The card says "approved" rather than "succeeded" for subagent calls.
- **A later turn.** Known interrupted or failed display outcomes remain on the earlier card. Completed turns with no root result remain unknown, not successful.
- **Same names.** Names, title formatting and the `subagent:` prefix are never parent routing or permission authority.

## Platform notes

None specific.

## Security notes

Subagent approvals are Nanocoder approvals (`SEC-09`). See [`security.md`](../security.md).

## Dependencies on Nanocoder changes

The subagent event projection in [`acp-integration.md`](../acp-integration.md#nanocoder-changes-needed).

## Open questions

`OQ-03`.

## Acceptance criteria

| Criterion | Success item |
|---|---|
| Asking for a delegated task shows a subagent run with live progress. | `SP-05` |
| A subagent approval request appears, names the subagent, and can be answered. | `SP-05` |
| Stopping cancels the work and the thread returns to Interrupted. | `SP-05` (full per-child stop depends on `SUB-08`) |

[wp-scope]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L102-L126
[wp-er]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L291-L342
[wp-risks]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L635-L648
[nc-limits]: https://github.com/Nano-Collective/nanocoder/blob/fc01e239a80ddb2e09ca174e3c909508832d5340/source/subagents/subagent-executor.ts#L70-L74
[nc-loop]: https://github.com/Nano-Collective/nanocoder/blob/fc01e239a80ddb2e09ca174e3c909508832d5340/source/acp/acp-conversation.ts#L495-L548
[nc-poll]: https://github.com/Nano-Collective/nanocoder/blob/fc01e239a80ddb2e09ca174e3c909508832d5340/source/acp/acp-conversation.ts#L660-L704
[nc-approval]: https://github.com/Nano-Collective/nanocoder/blob/fc01e239a80ddb2e09ca174e3c909508832d5340/source/acp/acp-conversation.ts#L98-L160
[nc-policy]: https://github.com/Nano-Collective/nanocoder/blob/fc01e239a80ddb2e09ca174e3c909508832d5340/source/tools/approval-policy.ts#L49-L82
[nc-replay]: https://github.com/Nano-Collective/nanocoder/blob/fc01e239a80ddb2e09ca174e3c909508832d5340/source/acp/agent.ts#L925-L938
[nc1105]: https://github.com/Nano-Collective/nanocoder/issues/1105
