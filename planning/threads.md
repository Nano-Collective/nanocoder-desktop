# Threads and the live workspace

Phase 1.5 composes `CHAT-03`, `CHAT-04`, `CHAT-12`, `CHAT-13`, `CHAT-14` and
`DATA-07` through ThreadService and the existing thread IPC contracts.
Connecting runs initialise only. The first accepted prompt creates a session,
sets its mode, stores the real ID, then publishes user content. Titles and
desktop metadata may persist; transcripts, drafts, tools, terminal results and
stderr do not.

The rail and palette share metadata actions. The workspace keeps each
project/thread conversation and draft separate. Running disables sending, not
drafting; no queue or automatic send is added. Mapped terminal results settle
the correct turn after switching away and back, but stale command tickets and
replaced-generation callbacks remain refused.

Runtime metadata writes re-read the exact current session and folder owner,
then patch only their own fields. A generated title accepted while another
prompt prepares, after a recovery check or during terminal-event delivery
cannot be overwritten by an earlier header. Archive has no asynchronous gap;
rename updates only the title; view-only and permission state use current rows.

## Retired technical owners and retained protections

The technical session cache, prompt/cancel helpers and legacy metadata listener
are removed only after their thread-scoped twins pass. All twins below are in
`source/main/threads/thread-service.spec.ts`, unless another file is named.

| Former protection | Thread-owned proof |
|---|---|
| Queued reopen behind idle stop cannot spawn after detach | `thread detach cancels a reopen queued behind idle stop without a second runtime resolution or spawn` |
| Recovery applies safe mode before ready, using the supplied starting connection | `thread recovery uses the supplied starting connection and replaces its mapped snapshot without raw replay or re-prompting` |
| Failed-process detach clears scheduled retry | `detaching a failed thread cancels its pending recovery without a later launch` |
| Failed cached resume and missing mode cannot prompt | `cached resume-fails`, `cached mode-fails`, `cached no-normal`, `cached missing-session` and `cached no-resume` keep identity and require explicit same-history retry |
| Missing/unsupported resume and failed mode cannot recover by creating or re-prompting | Five `automatic thread recovery stays unavailable without replacement history or re-prompt` cases |
| Recovery stays starting during mode confirmation and detach awaits child exit | `thread recovery remains starting through slow mode confirmation and detach settles the child without replaying content` |
| Activity, running/start cancellation, idle preservation and all-settled cleanup | `thread lifecycle attachment reports activity`, `thread detach cancels running and starting projects while preserving idle processes`, `thread detached cleanup settles every project even if one stop rejects` |
| Located root/cwd and already/late-aborted recovery cannot resume or replace history | `thread recovery refuses a located root or mismatched supplied connection before session resume`, `thread recovery refuses already-aborted and late-aborted mode results without replacing history` |
| Pending new/resume/mode work, cancelled or replaced preparation cannot publish content | Four `thread detach owns` cases, four `thread cancel stops` cases, four `a late resumed/new mode result` cases and `a mode result from a replaced connection cannot commit readiness or content` |
| Signal exit settles activity and revokes approval | `signal exit settles the thread activity and revokes its pending approval`; supervisor exit/approval test retained independently |
| Cancel uses only the saved active owner and waits for settlement | `thread cancellation scopes the active session and cancels every approval without allowing it`, `thread cancellation waits for the exact owning supervisor settlement before replying` |
| Strict cancellation payload refuses renderer session IDs before execution | `cancelThread refuses renderer session identities and malformed scopes before invoking the thread service`, in `source/main/ipc/workspace.spec.ts` |
| Metadata belongs only to its original prompt owner | Resolved metadata session/root/cwd replacement and detached-response cases |
| Legacy duplicate content cannot enter the renderer | Preload absence and literal legacy-event refusal in `e2e/streaming.e2e.ts` |

Ordinary failed history open deliberately replaces TechnicalSessions'
“fresh session on retry” rule: the thread keeps its saved ID and replay prefix,
shows the actual resume/mode reason and refuses prompts. Other thread metadata
and the initialised ACP process remain usable. Explicit stop-and-reopen retries
the same history, never `session/new`. Automatic recovery starts from an
already-crashed process and remains unavailable if that saved history cannot
be restored safely. Phase 1.8 now distinguishes missing history from retryable
resume/mode/capability failures. Only actual `NOT_FOUND` becomes view-only:
the existing composer guard hides input, while a dashed muted notice retains
desktop title/activity and calls the existing metadata-only new/remove paths
(`CHAT-09`). A retryable failure stays failed with its safe reason and an
explicit action that reopens only that saved thread, without queuing its draft.
Built tests verify notice tokens/contrast, keyboard focus and native
retry/new/remove in both themes. Retry resumes the exact saved ID with safe
mode confirmation and no queued prompt; new/remove leave ACP diagnostics
unchanged. Discovery/import remain pending; mode controls remain 1.9.
The [durable replay checkpoint](durable-replay.md) now composes atomic
structural replay IDs and passive run metadata before prefix replacement.
Live production now commits turn/execution identities and owning terminal
metadata through the same observer and batch allocator before publication.
Replay loading/flush gates are implemented. Complete `SUB-05` acceptance remains pending.
The merged 1.9 controls share the same authority.

## Bootstrap metadata

Opening the metadata store changes orphaned `running` and `waiting-approval`
rows to `interrupted`. This happens only at store bootstrap, not on live reads.
IDs, titles, the manual-title flag and every other metadata field stay unchanged.
No process launches, replay or terminal result is invented. A restarted broker
has no old approval authority: the real previous request IDs are refused before
any launch or answer. Store round-trip tests cover every state and both archive
groups; a ThreadService restart test checks the fresh broker, empty snapshot,
absent terminal and zero emitted events.

## Selected status glyph accessibility

Design deviation, approved for accessibility and left for the designer:
selected error `✕` and warning `◐`/`▲` glyphs use the neutral `surface` token
behind only the glyph. Their error/warning ink, selected `primary-soft` row and
2px `primary` rule are unchanged. No design token or `DESIGN.md` is edited.
Rendered checks require at least 4.5:1 in both themes. The remaining selected
`●`, `○`, `░`, `◌` and `◍` glyphs pass unchanged and get no backing rule.
Tests reduce motion when sampling stable theme colours rather than sampling
the permitted 200ms colour transition.

The rail uses a zero-minimum grid track so long titles truncate inside its
available width instead of widening the rail and scrolling its state glyphs
out of view. Built Electron checks cover both themes at 1240, 1020 and 840px,
including keyboard action focus and the unchanged selected 2px rule.
