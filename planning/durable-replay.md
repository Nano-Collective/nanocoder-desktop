# Durable replay identities

Phase 1.8 checkpoint for `CHAT-08`, `ACP-06/07` and the `SUB-05` producer.
This documents the implemented main-only live/replay boundary, not acceptance
of the complete phase or app/child restart/subagent workflow.

## Structural proof

`thread-history-mapping.ts` stages the supported transient prefix and maps
user boundaries plus exact ordered tool-call IDs. Complete matching requires
the same turn count, contiguous structural ordinals, identical ordered tool
sets, unique associations and a previously complete ledger. Changed,
truncated, inserted, reordered, colliding or unsupported boundaries keep the
readable prefix but withhold new durable joins. Repeated empty turn shapes
are also ambiguous. Existing rows remain intact through delta updates.

An unambiguous new history gets main-owned UUIDs once. A subsequent exact
mapping reuses those UUIDs. Prompt, task, title, answer, time, renderer row
index and content hash never participate. The available shape is not an
upstream immutable revision: content-only edits with an unchanged shape
cannot be independently detected at the pinned Nanocoder version.

The staged replay is bounded to 100,000 events and 16 MiB of JSON UTF-8.
The store still limits each accumulated identity collection to 10,000 rows.
Live permission and permission-closed packets are refused, not replayed.
Tool IDs retain their original bounded opaque strings.

## Ordering and bounds

The existing main-owned per-thread batch sequence remains the sole allocator.
For each bounded batch, an observation slot is derived as:

```text
slot = batchSequence * 10001 + eventOffset
0 <= eventOffset < 10000
```

Offset 10,000 is available for a batch high-water mark, not another event.
Exactly 10,000 events occupy one batch. A larger input reserves consecutive
batches through the same allocator, without overlapping slots or dropping
events. A zero-event boundary also reserves a batch sequence.

On a fresh owner, recover the base as the maximum of the current batch
sequence and `floor(storedHighWaterMark / 10001)`. The next batch starts
strictly above every stored slot, including a replay high-water mark.
Validate counters, each derived slot and the full reservation before advancing
the allocator. Overflow past `Number.MAX_SAFE_INTEGER` refuses the entire
reservation without advancing it.

Derived slots stay in main and metadata storage. The renderer receives only
the existing batch sequence, never `firstSlot` or `highWaterMark`. Replay
mapping derives within-batch offsets from these reserved ranges rather than
creating another counter. Main live publication uses the same helper and
splits an input larger than 10,000 events before publication. Empty terminal
batches retain their own sequence.

## Atomic observation

ThreadService still owns the same project authority, exact saved session,
native-root checks, safe acknowledgement and four control hooks. After these
succeed, ordinary open and recovery stage the complete replay mapping.
`thread-history-observer.ts` validates exact scope, identities, ordered slots,
generation and one replay epoch before applying identities and safe run rows
in one data-only SQLite transaction. Only success activates the candidate
observer and replaces the transient snapshot prefix.

Failed staging or COMMIT leaves the old prefix, IDs, safe run rows and
observer fences intact. Clear prepared-cache eligibility so explicit open
can retry the same saved ID. Never create a replacement session. Removal,
detach and disposal retire the corresponding observation memory.

`subagent-runs.ts` provides an additive passive `fork(repository)`. It copies
seen records, generation floors, ended turns, removal tombstones and disposed
state into independent collections and new closures over the staging
repository. Forking itself reads or writes nothing and adds no listener,
timer or connection. The staging repository reads committed role/status
metadata and stages writes. Existing maps remain unbounded, so their owner
must retire them; forking does not introduce a new lifetime policy.

The atomic wrapper uses an epoch and synchronous commit guard. Reentrant
candidates, direct live forwarding during staging, disposal/removal during
staging, older revisions and reused committed slots cannot swap in a fork.
An increased generation does not authorise an older global derived slot.
ThreadService live production calls `commitLive`, including owning turn
completion. This is a separate integration from replay's `commitReplay`:
live candidates fork the committed observer rather than starting a new one.

## Replay readiness

The ACP collector belongs to one exact requested session at a time. Foreign
updates cannot enter its prefix or become live activity during collection.
It accepts at most 100,000 updates and 16 MiB of their serialized JSON UTF-8,
including exact boundary values. Overflow drops the entire candidate, stops
and awaits the actual connection/child, and refuses readiness. It never
truncates a candidate into a successful prefix. Completion, error, close and
exit clear collection memory. Existing raw config capture and authoritative
session-control ownership remain unchanged; replayed config stays display only.

Main allocates an opaque UUID for each attempt and reuses it for the atomic
observer's replay epoch. The existing mapped turn event has an optional
`replay: {epoch, phase}` with only `begin`, `complete` and `failed`. These are
empty, nonterminal packets ordered by the same batch allocator. Snapshots
optionally carry `replayEpoch`. No request accepts either an epoch or phase.
Strict schemas reject malformed or unlisted marker fields. Epochs carry no
authority: the renderer compares them only.
Before its first begin marker, a recreated owner recovers the stored private
sequence floor. Even an exact batch-boundary high-water mark cannot be reused.

Only safe acknowledgement, owned control handoff, successful history commit
and atomic prefix replacement permit `complete`, followed by ready publication.
The snapshot's `replaying` flag is a readiness gate, not a process-running
assertion: it stays true after an unsuccessful attempt until a successful
completion. Failed or aborted replay does not replace the readable prefix,
persist a synthetic terminal, or change a cancelled turn into a failed one.
Native prompt, mode, model and permission mutations refuse while gated.
Mode/config work is checked before its control callback, including the existing
offline metadata-mode path. Explicit retry uses the same saved ID and a new
epoch, never a replacement session.

The renderer retires superseded epochs and uses its existing request and
sequence guards. Completion requests only the main cache snapshot, never
another resume. A prefix older than its complete marker cannot enable input.
One stale in-progress response may trigger one fresh completion read, not an
automatic retry loop. Project changes and reentrant prefix flushes cannot
restore retired buffered live events.

Existing synchronous 16 ms batcher flushes settle the old prefix before atomic
snapshot replacement. Only after that callback finishes may the matching
successful epoch release the renderer gate. The batcher, conversation stream
and subagent card do not acquire replay logic. The existing composer and
control-reason props explain loading or failure in lowercase while keeping
the draft editable and memory only. Nothing queues an automatic send.
Retryable recovery failures keep that draft editable and expose an explicit
same-thread retry through the existing open path. Ordinary open and recovery
share the same classification: actual `NOT_FOUND` makes the thread view-only;
other resume/mode/capability failures make it failed with their safe reason.
View-only hides the composer without discarding its memory-only draft
(`CHAT-09`). A plain-props dashed muted notice keeps the title/activity, states
the shared main-owned missing-history reason and offers the existing
metadata-only new/remove actions. The reason lists possible causes without
claiming which occurred. Mounted notice verification remains pending while
built-app launches are paused. A distinct new thread's exact prompt owner may still prepare
fresh controls; the failed thread, unowned callers and stale owners stay refused.

The mounted fake test holds replay until an event-driven fixture release. It
checks native prompt/mode/model/permission refusals, failure remaining gated
and usable controls after success. `PERF-03` measures 200 rendered messages
from receipt of replay completion to prefix display and usable composer/model/
mode controls, with a 2 s limit. Separate input, scroll, frame and event-loop
samples remain within 100 ms. This excludes process startup and makes no claim
about model-context continuation.

## Live production

The existing exact prompt lease owns one transient live record. A turn UUID
is committed before accepting its user event. The first tool occurrence gets
an execution UUID before tool publication. Title, progress and approval-only
updates reuse it within that turn; a later turn gets a different UUID even
when Nanocoder reuses the opaque tool ID. Ordinary tools get identities but
do not acquire delegation rows. Permission source hints remain display only.

Identity and passive run metadata commit before their corresponding event
batch is published. Text-only chunks do not write the ledger. The same
allocator still orders those chunks above the preceding committed slot.
The mapper clones candidate records, so refused commits cannot mutate the
live identity cache or the original passive observer.

Only the owning terminal settles its unfinished execution metadata. Known
completed executions survive a later turn cancellation. Explicit failed or
cancelled turn metadata is not changed to success by a normal ACP stop.
Approval-only completion does not prove execution success, and replay-marked
tools cannot enter the live path.

Stale or ended-owner notifications are dropped before permission/thread
metadata changes. A refused tool commit publishes no partial tool, marks the
ledger incomplete when storage permits, and requests cancellation through the
existing exact-owner exception. Notification callbacks do not throw through
the ACP reader. A refused terminal commit never publishes success or advances
the observer; the readable prefix receives a transient failure instead.

An actual cancelled result may finalise data while trust is revoked, using
the existing `runCancellationStep` and the same prompt lease. The private
append exception accepts only that lease, no events and an `ok/cancelled`
terminal. It creates no general metadata/execution capability and bypasses
neither root, epoch, saved-session nor replacement-connection checks.
Active live records retire in prompt cleanup. Thread removal, detach and
disposal still retire the passive per-thread owner.
Detach also removes ephemeral permission events from retained memory prefixes,
independently of dropped stale callbacks. Native requests are still cancelled,
never allowed; sequence, readable content and SQL stay unchanged, with no
synthetic terminal or revived card on reopen.

## Truthful history and remaining work

The additive optional tool `history.outcome` contains only an enum. Synthetic
completion becomes `unknown`, including the tool status consumed by existing
reducers. Justified previous completed/failed/interrupted identities retain
their outcomes; interruption uses the existing cancelled tool status.
Delegation observations are marked historical and never create permissions
or execution authority.

No transcript, tool argument/result, task, permission payload, raw frame,
stderr, prompt hash or file content enters the identity/run transaction.
Only allowed enums and IDs persist. The optional tool history projection is
transient. The renderer keeps only its validated outcome enum in the ordered,
immutable tool patch and forwards it to the existing card. Missing or unknown
historical outcome stays muted and unreported; known failed/interrupted
outcomes retain their word, glyph and existing error token. A known historical
completion is labelled previously reported, without a success glyph or colour.
Historical cards never expose live controls.

The built-app restart proof runs a live failed and unfinished delegation,
quits Electron, verifies the child exited, then relaunches with the same
temporary profile and opens the saved thread. The fake resumes the exact saved
ID with deterministic synthetic history and no transcript file. The test
asserts unchanged execution UUIDs and safe rows, retained failure, unknown
synthetic completion, exactly two inert cards and both-theme contrast checks.
It also rejects a replacement `session/new` or `session/load` in that process.
This positive proof does not complete missing-history or import
acceptance.

Still pending: view-only/retry actions; discovery/import;
app-and-child restart continuation and full phase 1.8/SUB-05
acceptance. Existing streaming and subagent views must retain their guards.
SUB-08/OQ-03 and the pinned 1.31 versus provisional 1.32 OQ-02 are not waived.
