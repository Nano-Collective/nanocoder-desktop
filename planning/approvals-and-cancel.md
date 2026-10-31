# Approvals and cancel

Implementation notes for phase 1.7 and U.6 from [work list #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

- Status: Draft
- Last updated: 2026-10-31

Requirements: `CHAT-06`, `ACP-10`, `CHAT-07`, `ACP-09`, `CHAT-21`, `A11Y-02`. Visual decisions remain in [`DESIGN.md`](../DESIGN.md), which follows the approved mockup where they differ (`DEC-41`).

## Permission ownership

Nanocoder supplies the title, option IDs, kinds and labels. `PermissionBroker` remains the main-process authority: only an offered option on a waiting request counts. Unknown IDs, duplicate answers and closed requests are refused. With no permission handler, the ACP client answers cancelled, never allowed.

The renderer forwards only the request ID and option ID. It never records a remembered allow/reject policy, fabricates options or interprets an option's name as permission. `ask_user` uses the same selection-only flow, with Nanocoder's own question and option labels; there is no free-text answer.

Main adds one display-only question hint (`DEC-41`). It marks a permission request as a question only when the request matches the exact shape Nanocoder uses for `ask_user`: the same tool call announced this turn, matching question and option names, and `answer-N` option ids. Nanocoder reports no tool name, so this is recognition from shape, not a reported fact. A request that does not match stays an ordinary approval. The hint never adds, renames or reorders an option, never changes an option ID, and never lets the renderer answer. Its security review is required before merge.

The pinned Nanocoder `fc01e239` offers Allow/allow_once and Deny/reject_once for protected tools. All four ACP option kinds are covered with the fake fixture. The desktop does not invent allow-always or reject-all controls when Nanocoder does not offer them.

## Card and keyboard behaviour

`ApprovalRequests` accepts shared `PermissionRequestInfo` values, the shared mode, a busy flag, an optional fallback-focus ref and an `onAnswer` callback with the shared permission-answer signature. It contains no direct desktop bridge call. ThreadService can bind the callback to `answerThreadPermission` later.

The card keeps the design's warning border, 2.2-second pulse and reduced-motion refusal of animation. Its named non-modal alert dialog takes focus without choosing a default button. The title includes the session's actual mode, followed by Nanocoder's title as escaped command/question text and a short note that the choice is sent to Nanocoder.

Options retain their labels and success/reject variants. Keys 1 to 9 select only an offered option while its card has focus. Repeated, modified, empty and multi-character key events are ignored. Other controls do not share these shortcuts. Additional options remain native buttons reached with Tab and Enter.

One origin is retained across the request queue. Focus moves to the oldest remaining request, then returns to the original control once it is available. If that control has disappeared or remains disabled, it falls back to the composer. A busy composer is not focused until it becomes enabled. Changing project unmounts the old queue without moving focus back into it.

Taking focus scrolls the whole card into view, not just its inner dialog. A token-based scroll margin keeps the border and pulse clear of the stream edge, including after earlier turns have filled the stream.

Focus recovery also runs after an answer settles and after any request-array change, including same-size queue replacement. A refused answer leaves the request pending, re-enables its options and recovers focus if disabling the selected button left it on the body.

Native palette and shortcut dialogs keep focus while open. Incoming approvals are announced by count only through the dialog's pre-existing polite region, without request titles, labels or IDs. Only the non-inert layer's notification region is active. After the dialog closes, a waiting approval takes focus, or a cancelled queue returns focus to its original control or composer. Explicitly opening an overlay from an approval and closing it returns to that exact approval control; Escape never chooses an option.

`.approval-key-hints .ui-key-hint` uses full-opacity muted ink. `DESIGN.md` retires the 55% key-hint style, so this is no longer a deviation (`DEC-41`).

## Question dialog

A request with the question hint opens the question dialog (`DEC-41`), titled "Nanocoder needs a choice". It shows Nanocoder's question text and each offered option as a numbered button. Choosing an option sends the same request ID and option ID as the approval card, through the same main-process check. There is no free-text field.

Closing the dialog, with its close control or Escape, does not answer the question. The request collapses to the approval shelf above the composer and stays pending until the user chooses an offered option there or cancels the turn. The dialog traps focus while open. When it closes, a waiting approval takes focus, as described above.

## Cancel

The `cancelThread()` bridge sends only desktop project/thread IDs on `threads:cancel`. Main resolves the saved Nanocoder session and cancels only that active owner. Renderer-supplied session IDs, extra fields and malformed scopes are rejected before the service runs. An unknown thread is refused; a known sessionless or idle thread is a local no-op. The strict schemas and service-invocation refusal tests live in `source/main/ipc/workspace.ts` and its adjacent spec.

Cancellation reuses `ProjectSupervisor.cancel`, which cancels pending permissions and waits for the turn to settle. A cancelled turn is shown as interrupted, not successful or failed. The cancel control remains available during approval, and the composer becomes usable again afterwards.

The temporary `sendPrompt`, `answerPermission`, `cancelPrompt` and legacy event bridge are retired. ThreadService owns prompt, approval and cancel routing. Its tests retain scoped forwarding, offered-option refusals, cancellation during preparation and the requirement to await supervisor settlement.

## Verification

Logic and refusal work follows red, green, refactor. Main tests cover missing context, strict extra-field refusal, scoped forwarding and waiting for settlement. Built-app tests cover all offered kinds and exact selected IDs, selection-only questions, pending and non-pending cancellation, queue focus, focus return, shortcut refusals and repeated-turn card geometry. The hand-back report records exact red/green commands and evidence.

Use fake Nanocoder only for visual QA, taking `/tmp/nc-m1-qa.lock` before the launcher. Capture both themes at 1240, 1020 and 840px, with a focused card and after answering, plus accessibility audits. Save safe captures under `.qa/wave-3/approvals/`; stop the printed launcher PID, verify port 9333 is clear, then release the lock. Known design contrast gaps remain reported, not silently changed.

macOS QA recorded all twelve states, asserting `app://renderer/index.html` before each audit. Dark focused cards and every answered state had no violations. Light focused cards retained the documented title (3.88:1) and allow-label (4.35:1) contrast gaps. Full-opacity key hints measured 5.834:1 in dark and 5.295:1 in light. These known design gaps are not an AA waiver; independent security review remains required.

`DEC-41` moves the approval title and allow/reject labels to on-surface ink. Calculated from the tokens, the title is 11.46:1 in light and 12.13:1 in dark, and the labels are 12.46:1 and 13.51:1 in light and dark on the shelf panel. The old title and allow-label gaps are therefore closed by token change, not by waiver. The rendered recheck in the UI verifier's captures still has to confirm these figures.
