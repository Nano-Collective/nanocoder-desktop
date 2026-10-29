# Approvals and cancel

Implementation notes for phase 1.7 and U.6 from [work list #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

- Status: Draft
- Last updated: 2026-10-29

Requirements: `CHAT-06`, `ACP-10`, `CHAT-07`, `ACP-09`, `CHAT-21`, `A11Y-02`. Visual decisions remain in [`DESIGN.md`](../DESIGN.md).

## Permission ownership

Nanocoder supplies the title, option IDs, kinds and labels. `PermissionBroker` remains the main-process authority: only an offered option on a waiting request counts. Unknown IDs, duplicate answers and closed requests are refused. With no permission handler, the ACP client answers cancelled, never allowed.

The renderer forwards only the request ID and option ID. It never records a remembered allow/reject policy, fabricates options or interprets an option's name as permission. `ask_user` uses the same selection-only flow, with Nanocoder's own question and option labels; there is no free-text answer.

The pinned Nanocoder `fc01e239` offers Allow/allow_once and Deny/reject_once for protected tools. All four ACP option kinds are covered with the fake fixture. The desktop does not invent allow-always or reject-all controls when Nanocoder does not offer them.

## Card and keyboard behaviour

`ApprovalRequests` accepts shared `PermissionRequestInfo` values, the shared mode, a busy flag, an optional fallback-focus ref and an `onAnswer` callback with the shared permission-answer signature. It contains no direct desktop bridge call. ThreadService can bind the callback to `answerThreadPermission` later.

The card keeps the design's warning border, 2.2-second pulse and reduced-motion refusal of animation. Its named non-modal alert dialog takes focus without choosing a default button. The title includes the session's actual mode, followed by Nanocoder's title as escaped command/question text and a short note that the choice is sent to Nanocoder.

Options retain their labels and success/reject variants. Keys 1 to 9 select only an offered option while its card has focus. Repeated, modified, empty and multi-character key events are ignored. Other controls do not share these shortcuts. Additional options remain native buttons reached with Tab and Enter.

One origin is retained across the request queue. Focus moves to the oldest remaining request, then returns to the original control once it is available. If that control has disappeared or remains disabled, it falls back to the composer. A busy composer is not focused until it becomes enabled. Changing project unmounts the old queue without moving focus back into it.

Design deviation, agreed for accessibility: `.approval-key-hints .ui-key-hint` uses full-opacity muted ink rather than the design's 55% opacity. This keeps required key hints readable and avoids the known contrast conflict. `DESIGN.md` remains unchanged for the designer to resolve.

## Cancel

The temporary technical-gate `cancelPrompt()` bridge sends a strict empty payload on `nanocoder:cancel-prompt`. Main chooses the active project and session; renderer-supplied IDs or extra fields are rejected. No open session returns `AGENT_UNAVAILABLE`; an open session with no active turn is a clean no-op.

Cancellation reuses `ProjectSupervisor.cancel`, which cancels pending permissions and waits for the turn to settle. A cancelled turn is shown as interrupted, not successful or failed. The cancel control remains available during approval, and the composer becomes usable again afterwards.

The temporary channel retires with `sendPrompt` and `answerPermission` when ThreadService replaces the technical gate. It does not extend the `threads:*` contract.

## Verification

Logic and refusal work follows red, green, refactor. Main tests cover missing context, strict extra-field refusal, scoped forwarding and waiting for settlement. Built-app tests cover all offered kinds, selection-only questions, pending and non-pending cancellation, queue focus, focus return and shortcut refusals. The hand-back report records exact red/green commands and evidence.

Use fake Nanocoder only for visual QA, taking `/tmp/nc-m1-qa.lock` before the launcher. Capture both themes at 1240, 1020 and 840px, with a focused card and after answering, plus accessibility audits. Save safe captures under `.qa/wave-3/approvals/`; stop the printed launcher PID, verify port 9333 is clear, then release the lock. Known design contrast gaps remain reported, not silently changed.
