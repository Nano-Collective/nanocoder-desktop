# Subagents

How the desktop shows, approves and stops bounded Nanocoder subagents.

- Status: Draft
- Last updated: 2026-10-23
- Drafted by: @akramcodez

## Purpose

Let the user delegate a bounded subtask, follow each child agent, and stop it when needed ([whitepaper, v1 scope][wp-scope] item 3, `SP-05`). Nanocoder owns delegation; the desktop renders it. Visual design: see `DESIGN.md` (not yet written).

## What Nanocoder exposes at `8a5f4d4`

- **Bounds.** Delegation depth 2, at most 5 concurrent subagents ([source][nc-limits]).
- **Projection.** A subagent run is the parent's `agent` tool call. While it runs, Nanocoder polls subagent progress every 1.5 seconds and updates the card title with the subagent name, token count and last tool ([source][nc-poll]). There is no child session ID, no parent-child event and no per-child status.
- **Approvals.** Subagent tool calls that need approval arrive as `session/request_permission` with IDs prefixed `subagent:` and the subagent name in the title. They ask regardless of the session mode, are marked completed as soon as they are approved (before running), and share one approval handler per process ([source][nc-approval], [docs][nc-acp-limits]).
- **Cancellation.** Only the whole turn (`session/cancel`).

Results flowing back from subagent tools are tracked in [nanocoder#1105][nc1105] (open).

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
| Subagent name | The polled card title | A child event |
| Status | The parent `agent` tool call status | Per-child status |
| Progress | Token count, tool count and last tool, every 1.5 seconds | Child events as they happen |
| Approvals | `subagent:` permission requests | Same, routed by session |
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
[nc-limits]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/subagents/subagent-executor.ts#L70-L74
[nc-poll]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-conversation.ts#L660-L705
[nc-approval]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/source/acp/acp-conversation.ts#L90-L160
[nc-acp-limits]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/docs/features/acp.md?plain=1#L84-L88
[nc1105]: https://github.com/Nano-Collective/nanocoder/issues/1105
