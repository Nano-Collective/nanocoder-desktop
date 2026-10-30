# Shared project-operation leases

Phase 1.8 foundation for `CHAT-17`, `ACP-06` and phase 1.9 controls. The
`createProjectOperations` authority in `source/main/threads/project-operations.ts`
has focused test-first coverage. ThreadService now shares one authority across
prompt preparation/turns, history open and recovery, with owned control hooks and
detach settlement. It adds no IPC or database schema and never creates a session
before first send. The remaining phase 1.8 work is not accepted by this checkpoint.

## One authority

ThreadService creates one authority and exposes it as `projectOperations`.
Controls use its main-only `runProjectOperation` wrapper so their work shares
attachment cancellation, activity and settlement tracking with preparation.
Do not instantiate another mutex for controls. Lane A owns this composition;
lane B injects the control dependencies below.

The main-only `getControlConnection(projectId)` runtime getter uses the same
connection binding as the authority. It can expose the owned starting recovery
connection while the supervisor's public getter still refuses. It returns
undefined for unavailable, invalidated active or disposed scopes. Recovery
lookup visibility follows both the supervisor and owning lease abort signals.

The constructor takes synchronous main-only metadata adapters:

- `getProject(projectId)`: current canonicalRoot, sessionCwd and trust, or absent.
- `getThread(projectId, threadId)`: the scoped current cwd and saved session ID,
  or absent. A globally matching ID in another project does not count.
- `getConnection(projectId)`: the current connection object, or absent. Object
  identity is the opaque connection-generation token, not an ACP session ID.

Stored paths must already be canonical. The authority checks exact root/cwd
ownership synchronously; it does not replace ThreadService's asynchronous native
canonical-path, trust, process-root or offered-value checks.

## Acquisition, steps and release

`runProjectOperation(projectId, kind, work, {threadId?, signal?})` reserves the
project synchronously, before work or its first await. It returns a promise.
Missing/untrusted/foreign-cwd projects and already-aborted/disposed scopes refuse
without invoking work. An occupied project immediately rejects with retryable
`BUSY`, no queue and no work. Different projects remain independent.

The callback receives a frozen main-only `ProjectOperationLease` containing its
project ID, canonical root, epoch, kind and abort signal. These are not IPC data
or renderer capabilities. There is no public release or replacement method.

- `assertCurrent(lease)` checks this exact authority's lease, current slot,
  project epoch, root/trust and any bound thread/session/connection.
- `bindThread(lease, threadId)` binds the scoped row once. Passing `threadId` in
  the acquisition scope performs this before invoking work.
- `bindConnection(lease, connection)` binds the actual current connection once.
  A replacement cannot be rebound into an old lease.
- `bindSession(lease, savedId)` permits the explicit null-to-first-saved-ID
  transition after the owner stores the real new ID. Assert ownership before
  that write. A later saved-ID replacement is refused.
- `runOwnedStep(lease, work)` checks ownership before invoking work and after
  its promise settles. It also retains the slot through that promise's
  settlement. It does not acquire or re-enter a lease.

First send uses one lease for connection/trust preparation, session/new, offered
safe mode, real-ID storage, any still-valid explicitly confirmed one-use yolo
choice and prompt/terminal settlement. Await the owned steps. Controls use the
same helpers, not a public entry that reacquires. A nested public acquisition
receives BUSY, rather than waiting on itself.

Permission answers and cancellation retain their existing active-turn owner and
offered-option checks; they never acquire a competing slot. The authority can
retain an owned cancellation step after the prompt returns. The remaining
legacy mutation/cancel and project-lifecycle integration is follow-up phase 1.8
work, not a claimed part of this preparation-hook checkpoint.

## Optional main-only control dependencies

All four are optional. Existing operation without controls remains supported.

```ts
resolveLiveMode(projectId, threadId, sessionId, connection);
validateBeforePrepare(lease, thread);
onSessionPrepared(context);
beforeFirstPrompt(context);
```

`resolveLiveMode` returns a `NanocoderMode` or undefined. A null saved ID asks for
the scoped pending choice; a real ID asks for acknowledged live mode bound to
that exact connection. It projects ThreadInfo for IPC/events and proves prepared
cache readiness, never supplies repository-write fields. Main persistence still
reads the raw current row and keeps non-yolo metadata; the store coercion is
unchanged. With controls installed, no live cache means no prepared-session reuse.

`validateBeforePrepare(lease, thread)` is synchronous inside the current lease,
before ThreadService launches or prepares a session. Recovery calls it before
session/resume, using the supervisor-supplied starting connection. It must refuse
a stale/dropped pending choice before safe fallback can hide that intent.

Both session hooks run through `projectOperations.runOwnedStep`, never another
acquisition. Their main-only context contains the lease, cloned fresh raw thread
metadata, bound connection, cloned acknowledged SessionInfo and source
`new`/`resume`. The extra `requestedMode` captures raw metadata at prompt entry;
it is not confirmation or a substitute for B's pending-choice validation.

`onSessionPrepared` runs only after safe new/resume acknowledgement and saved
identity, with ready offers if the connection exposes the main-only getter.
Failed, abandoned or stale preparation never marks an attempt successful.
The observer can read bounded current offers from the bound connection; it
records safe live mode without consuming a pending yolo request.

`beforeFirstPrompt` runs before user content or the first prompt of each prepared
connection/session scope, including after same-connection re-preparation.
It applies/consumes only a still-valid explicitly confirmed pending choice.
After it settles, ThreadService re-reads and patches only its own row fields;
it never writes back the earlier SessionInfo.mode. Pending/live yolo stays in
main memory and is projected, not saved.

Prepared reuse requires the same connection, ready `getSessionOffers(savedId)`
when that getter exists, and a resolved live mode when B's resolver is installed.
Missing readiness/cache forces normal safe resume of the same saved ID, never
replacement session/new. Missing readiness after a hook refuses before content.
Without the new getter/resolver, existing client behaviour is unchanged.

## Invalidation and cleanup

- `invalidate(projectId, shutdownPromise?)` increments the epoch and aborts the
  existing lease immediately. It does not clear its slot.
- `invalidateThread(projectId, threadId, shutdownPromise?)` acts only when that
  exact thread is bound; removing an unrelated idle row does not abort a turn.
- `dispose()` invalidates all holders and refuses future operations.
- `isBusy(projectId)` includes invalidated holders still settling.

Detach and disposal invalidate composed operations; detach registers each child
shutdown promise before cleanup can release its slot. Broader composition must
also call invalidation for relocation/root replacement,
restart/connection replacement, project deletion/trust revocation and disposal.
Its thread removal/history deletion paths invalidate the exact owning thread.
Register any child shutdown promise when invalidating; the caller still owns
reporting shutdown errors.

The holder releases in `finally` only after its work and all registered owned
steps/shutdown barriers settle. New barriers added during cleanup are included.
The exact-token check prevents stale cleanup from clearing a newer holder.
Abort reasons returned by this authority are fixed, not arbitrary signal reasons.
Late signals from a released scope cannot invalidate a replacement owner.

Lifecycle invalidators must not try to acquire the occupied slot. Metadata reads
and drafts remain available. Returning a controls revision does not extend the
lease; upstream config uncertainty still needs B's separate invalid-offers gate.
Persisted yolo is never authorisation, and no control action pre-creates a
session. Durable replay, discovery/import, U.4 notices, C's identity transaction
and the remaining application-level lease integration remain phase 1.8 work.
