# Technical gate write-up

What the technical gate (phases G.1 to G.5) proved about driving `nanocoder --acp`, what Nanocoder does that the plan did not know, and what is still open. Phase G.6 (the runtime measurement) is separate.

- Status: Draft
- Last updated: 2026-10-28
- Drafted by: @akramcodez

## What was proven

Every step ran against a real Nanocoder, with a scripted model so no API key is needed ([`testing-strategy.md`](testing-strategy.md#integration-tests-against-nanocoder---acp)).

| Step | Phase | Test |
|---|---|---|
| Find Nanocoder and Node by absolute path, launch without a shell | G.1 | `runtime.spec.ts`, `launch.spec.ts` |
| `initialize` with read-only capabilities, stdout as protocol only, redacted stderr ring | G.2 | `acp-client.spec.ts`, `protocol-stream.spec.ts`, `stderr-ring.spec.ts` |
| Ask before trusting a folder, record trust through Nanocoder, a changed folder is asked about again | G.3 | `acp-client.acp.ts`, `trust.spec.ts`, `open-project.spec.ts` |
| A real turn, permission requests answered by the user, plugins load at the project root | G.4 | `turn.acp.ts`, `permissions.spec.ts`, `e2e/connect.e2e.ts` |
| Restart both processes, resume, follow-up with context, missing session, mode after resume | G.5 | `resume.acp.ts`, `acp-client.spec.ts` |

## What Nanocoder does

Observed against Nanocoder `8a5f4d4` and `main` at `f5d8217`. The first six rows are also in [`acp-integration.md`](acp-integration.md#known-nanocoder-acp-quirks).

| Behaviour | What the desktop does |
|---|---|
| A resumed session starts in `auto-accept`, whatever mode it was in | Sends `session/set_mode` after every resume, and the thread takes no prompt until it succeeds (`DEC-31`). |
| `session/resume` replays the thread as `session/update` notifications: user messages, agent text and finished tool calls | Collects them during the call and returns them as history, so they are never shown as new activity (`ACP-07`). |
| The replay ends with an empty text chunk that only carries metadata | Drops empty text chunks. |
| A missing session is an internal error (`-32603`) with `data.details` of `Session not found on disk: <id>`, with no distinct code | Reads `data.details` and says the session was deleted or removed by retention (`ACP-19`). |
| Unknown and deleted sessions fail the same way, and the connection stays usable | A new session can start on the same connection. |
| Deny marks the tool `failed` and the turn continues; a cancelled answer ends the turn | Reports the stop reason as given. |
| `execute_bash` asks in every mode except `yolo` | A file edit is what shows the mode: `write_file` asks in `normal` and runs without asking in `auto-accept`. |
| Trust refusals share exit code 1 with other startup failures | Matches the message text ([nanocoder#1899](https://github.com/Nano-Collective/nanocoder/issues/1899)). |

## What the tests do not prove

- **A model that remembers.** The scripted model replays fixed answers, so "the follow-up is answered correctly" is shown by what Nanocoder sends the model: the earlier user and assistant messages, then the new question. Whether a real model answers well is the manual packaged restart-and-resume test in [`testing-strategy.md`](testing-strategy.md#packaged-restart-and-resume-test).
- **Cancel during a turn or a pending permission.** Not built yet (`ACP-09`).
- **Two sessions with different working directories in one process.** Sessions run at the project root in v1 (`DEC-30`).
- **Retention.** A session deleted by Nanocoder's retention looks the same as a deleted one; the desktop cannot tell them apart (`OQ-16`).
- **A resumed thread in the app.** Resuming works in the client and in `openProject`, but no screen offers it yet. The thread store comes in phase 1.1.

## Platforms

| Platform | Unit, end-to-end and ACP tests | Recorded |
|---|---|---|
| Linux | Pass | 2026-10-28, local, against Nanocoder `main` |
| macOS | Run by the ACP job on the pull request | Pending |
| Windows | Run by the ACP job on the pull request | Pending |

Fill in the last two rows from the pull request's ACP job before ticking the last G.5 result.
