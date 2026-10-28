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

## The runtime (G.6)

`scripts/measure-runtime.mjs` runs `nanocoder --acp` five times under each runtime and records `PERF-02` (spawn to `initialize` answered), memory after the process has settled for two seconds, and failures. It also starts each runtime with only the system folders on `PATH`, to see whether either needs a `node` of its own. On macOS it signs a copy of the sidecar with the hardened runtime and tries it with no entitlements, then with the ones V8 may need. The sidecar is the pinned Node in `scripts/node-sidecar.json`, downloaded by `scripts/fetch-node-sidecar.mjs` and refused unless its SHA-256 matches the pin. The ACP job runs it on every pull request, on all three platforms, as an advisory step. An `initialize` that returns an error counts as a failure, and a `codesign` failure is recorded as that attempt's result instead of ending the run. The trust is recorded once by a separate trust launch, as the desktop does (`DEC-30`), so the measured launches set no trust variable.

The ACP job on [#21](https://github.com/Nano-Collective/nanocoder-desktop/pull/21) ran it on 2026-10-28 on GitHub's runners, against the pinned Nanocoder build, five launches each:

| Platform | Runtime | Node | Startup, median (range) | Idle memory, median | Failures |
|---|---|---|---|---|---|
| macOS arm64 | Electron's Node mode | 24.22.0 | 653 ms (458 to 736) | 218 MB | 0 of 5 |
| macOS arm64 | Node sidecar | 22.23.4 | 535 ms (507 to 711) | 216 MB | 0 of 5 |
| Windows x64 | Electron's Node mode | 24.22.0 | 1036 ms (1018 to 1152) | 179 MB | 0 of 5 |
| Windows x64 | Node sidecar | 22.23.4 | 1218 ms (1176 to 1311) | 150 MB | 0 of 5 |
| Linux x64 | Electron's Node mode | 24.22.0 | 418 ms (405 to 1129) | 266 MB | 0 of 5 |
| Linux x64 | Node sidecar | 22.23.4 | 493 ms (489 to 501) | 207 MB | 0 of 5 |

On a developer machine (Linux, WSL2, Nanocoder 1.31.0 `dist`) three repeats gave 582 to 642 ms and 235 MB for Electron's Node mode, and 661 to 729 ms and 216 to 219 MB for the sidecar.

- **Nothing fails, and everything is far under the 5 second line in `PERF-02`.** Nanocoder runs under Node 24 in Electron's Node mode as well as under Node 22.
- **Startup does not separate the two.** Which one is faster flips between platforms, and an earlier CI run on macOS had them the other way round (562 ms against 624 ms). Treat startup as a tie.
- **Memory favours the sidecar on Linux (207 against 266 MB) and Windows (150 against 179 MB), and is level on macOS.** Windows is the slowest platform to start, about a second for both.
- **No Node on `PATH`.** With only the system folders on `PATH`, both runtimes start on all three platforms, Electron with `ELECTRON_RUN_AS_NODE` set. The first version of the harness left that variable out for Electron, which launches it as a GUI app and exits with an error, so its Electron result was not a Node-mode measurement; the review caught it and the harness is fixed. This shows the sidecar needs no Node of its own. It does not show what an MCP server or hook that runs `node`, `npm` or `npx` needs; that still has to be documented.
- **Size the sidecar adds.** Linux x64: 119.1 MB unpacked, 56.8 MB downloaded. macOS arm64: 107.8 MB unpacked, 50.0 MB downloaded. Windows x64: 83.0 MB unpacked, 35.6 MB downloaded. An installer compresses, so the added download is nearer the archive than the unpacked size. macOS x64 was not measured, because the job runs on an arm64 runner. Electron's Node mode adds nothing.
- **Pinned download.** Node `v22.23.4`, released 2026-10-20, with the hashes of the official `SHASUMS256.txt` for macOS arm64 and x64, Linux x64 and Windows x64. A wrong hash is refused and leaves nothing in the cache.
- **macOS hardened runtime: inconclusive.** The sidecar started with the hardened-runtime flag set and no entitlements, with `allow-jit`, and with `allow-jit` and `allow-unsigned-executable-memory`; the harness checks the flag with `codesign` before each launch. That is surprising for a runtime that generates code, so the ad hoc signature on a CI runner probably does not enforce the restriction the way a notarised build does. Do not read it as "no entitlements are needed". Suggestion (not discussed): sign the sidecar with `allow-jit` and `allow-unsigned-executable-memory`, as Electron's own helper apps do, and confirm with the real signing identity in phase 4.2 (`OQ-10`).

**What this says about `DEC-38`.** The numbers give no performance reason to prefer Electron's Node mode, and the sidecar uses less memory on two of three platforms. The cost is 36 to 57 MB of download per platform and one more binary to sign and notarise.

## What the tests do not prove

- **A model that remembers.** The scripted model replays fixed answers, so "the follow-up is answered correctly" is shown by what Nanocoder sends the model: the earlier user and assistant messages, then the new question. Whether a real model answers well is the manual packaged restart-and-resume test in [`testing-strategy.md`](testing-strategy.md#packaged-restart-and-resume-test).
- **Cancel during a turn or a pending permission.** Not built yet (`ACP-09`).
- **Two sessions with different working directories in one process.** Sessions run at the project root in v1 (`DEC-30`).
- **Retention.** A session deleted by Nanocoder's retention looks the same as a deleted one; the desktop cannot tell them apart (`OQ-16`).
- **The directory a session resumes in.** The desktop sends the project root, but Nanocoder ignores it and resumes in the directory it saved, and the resume response does not report it. Sessions the desktop creates are saved at the root (`DEC-30`); one created by the CLI in a subfolder would resume there. `session/list` shows each session's directory, so a check belongs with the thread store in phase 1.1.
- **Memory with a project open.** The G.6 figure is the idle process after `initialize`, with no session. `PERF-09` is measured later, in the app.
- **A resumed thread in the app.** Resuming works in the client and in `openProject`, but no screen offers it yet. The thread store comes in phase 1.1.

## Platforms

| Platform | Unit, end-to-end and ACP tests | Recorded |
|---|---|---|
| Linux | Pass | 2026-10-28, local, against Nanocoder `main` |
| macOS | Pass | 2026-10-28, the ACP job on [#20](https://github.com/Nano-Collective/nanocoder-desktop/pull/20), against the pinned Nanocoder build |
| Windows | Pass | 2026-10-28, the ACP job on [#20](https://github.com/Nano-Collective/nanocoder-desktop/pull/20), built fresh because its cache does not restore there |

The unit, end-to-end and packaging jobs also pass on all three.
