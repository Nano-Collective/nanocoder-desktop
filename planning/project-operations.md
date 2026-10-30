# Shared project-operation leases

Phase 1.8 foundation for `CHAT-17`, `ACP-06` and phase 1.9 controls. The
`createProjectOperations` authority in `source/main/threads/project-operations.ts`
has focused test-first coverage. This early checkpoint is **not yet composed**
into ThreadService or lifecycle callbacks. It changes no IPC, session creation,
approval authority, UI, database or running application behaviour.

## One authority

Application composition must create one authority and share that exact instance
between ThreadService preparation/prompt/resume and phase 1.9 controls. Do not
instantiate another mutex for controls. Lane A owns this composition and the
existing recovery/detach migration; lane B uses the same owner.

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

Permission answers and cancellation validate main's existing active-turn owner,
then may run an owned step on that lease. They do not acquire another slot.
This keeps BUSY through cancellation settlement even if the prompt itself has
already returned. Existing request/option checks remain mandatory.

## Invalidation and cleanup

- `invalidate(projectId, shutdownPromise?)` increments the epoch and aborts the
  existing lease immediately. It does not clear its slot.
- `invalidateThread(projectId, threadId, shutdownPromise?)` acts only when that
  exact thread is bound; removing an unrelated idle row does not abort a turn.
- `dispose()` invalidates all holders and refuses future operations.
- `isBusy(projectId)` includes invalidated holders still settling.

Composition must call invalidation for detach, relocation/root replacement,
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
and application-level lease integration remain subsequent phase 1.8 work.
