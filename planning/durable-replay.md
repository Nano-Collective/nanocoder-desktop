# Durable replay identities

Phase 1.8 checkpoint for `CHAT-08`, `ACP-06/07` and the `SUB-05` producer.
This documents the implemented main-only replay boundary, not acceptance of
the complete phase or live/restart/subagent workflow.

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
creating another counter. Main live publication still needs to adopt the
same bounded splitting helper during the live producer follow-up.

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
`commitLive` uses the same atomic path, including owning turn completion,
but ThreadService live identity production is not composed yet.

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
transient.

Still pending: live turn/execution allocation and terminal composition;
bounded session-specific ACP replay collection; strict optional replay
markers and renderer epoch/16 ms flush gates; the muted word-and-glyph
“not reported” projection; view-only/retry actions; discovery/import;
app-and-child restart continuation; PERF-03 and full phase 1.8/SUB-05
acceptance. Existing streaming and subagent views must retain their guards.
SUB-08/OQ-03 and the pinned 1.31 versus provisional 1.32 OQ-02 are not waived.
