# Milestone 1 exit checks

These are bounded local checks, not milestone or release acceptance. Keep the
all-three-platform success boxes in [`roadmap.md`](roadmap.md) unchecked until
there is evidence for each platform. The targets in
[`testing-strategy.md`](testing-strategy.md) remain suggestions, with no agreed
reference machine.

## Automated local checks

`e2e/milestone-exit-checks.e2e.ts` uses the shared hidden Electron launcher and
fresh temporary desktop profiles. It adds no production hook or IPC method.
It emits timing and machine metadata only, not conversation or tool content.

| Requirement | Check | Limits |
|---|---|---|
| PERF-01 | Five fresh processes/profiles. Time from before launch until empty recents are visible and Add is enabled and keyboard focusable. Verify the picker action after the endpoint. Assert median at most 3 seconds. | Nanocoder is not started. OS filesystem caches are not flushed. Unpackaged hidden automation is not packaged/native-visible or reference-hardware acceptance. |
| PERF-02 | Time from before the renderer's Enter action on Open to the rendered `acp · ready` badge. Record the value and flag values over 5 seconds for investigation. | Includes picker stub, canonical/store/trust work, process/preflight startup, IPC and rendering. This is an end-to-end proxy, not separate spawn/initialize timestamps. MCP startup is not separately measured. |
| A11Y-01/02 | Keyboard Add, composer entry, palette filtering/Escape, offered permission rejection and focus return. | Native dialog display, OS shortcuts and spoken delivery still require manual acceptance. |
| A11Y-03 | Inspect Chromium's accessibility tree in initial shell, palette, pending approval and settled states. Check exposed control names and palette expanded/focused/selected and send-disabled states. | Bounded state coverage, not every control on every platform. Accessibility-tree exposure is not VoiceOver speech or a full AA audit. |

Normal fake-fixture command:

```sh
pnpm build
pnpm exec playwright test e2e/milestone-exit-checks.e2e.ts
```

For an admitted real development build, use only the open-to-ready test:

```sh
NANOCODER_EXIT_CHECK_CLI=/absolute/path/to/nanocoder/dist/cli.js \
  pnpm exec playwright test e2e/milestone-exit-checks.e2e.ts --grep PERF-02
```

That optional run creates a temporary Nanocoder config/data/project tree and
a loopback scripted provider. It sends no model prompt, uses no real account,
stubs explicit native trust acceptance and closes the child/provider on exit.
Do not set `NANOCODER_E2E_VISIBLE` for routine runs. Deliberate native or
screen-reader QA requires separate approval.

## Evidence boundaries

- SP-02: canonical folder selection, recents and trust-summary checks exist in
  `projects.e2e.ts`. They do not accept the later FILE-01 tree or remove the
  recorded pre-trust/fingerprint limitations of Proposed DEC-30.
- SP-03/04: `threads.e2e.ts`, `streaming.e2e.ts` and `approvals.e2e.ts` cover
  first-send identity, structured updates, offered choices and cancellation.
  Low-level pinned ACP success is not proof that desktop version admission
  accepts that build or that a real-provider native workflow was checked.
- SP-05: `subagents.e2e.ts` covers flat reported progress and whole-turn stop.
  SUB-05 live/replay metadata is app-composed by phase 1.8, with a whole-app
  fake-child restart check. Full SUB-05 acceptance, real child identities and
  hierarchy/per-child cancellation remain unproved.
- SP-06/PERF-03: `durable-replay.e2e.ts`, `replay-gates.e2e.ts`,
  `session-import.e2e.ts` and `supervisor-recovery.e2e.ts` cover application/
  fake-child restart, exact-session replay, import and missing/retryable history.
  Separate real pinned ACP tests prove context reaches the follow-up model
  request. This is not a single real-provider whole-Electron-restart check.
- A11Y-04/05: `stream-announcements.e2e.ts` verifies one polite atomic node,
  lifecycle/finished-response announcements, one-second write limits and
  modal host ownership. Chromium AX/DOM delivery is not native spoken delivery.
- PERF-04: `streaming.e2e.ts` checks 300 ordered updates, at least 100 updates
  per second and input/scroll/frame/event-loop response within 100ms. It is a
  local fake-stream result, not general scalability or memory evidence.

The known designer-owned light approval title/Allow contrast gaps and
glyph-only incomplete checks remain. No test addition waives them.
CI definitions are not evidence of Windows/Linux runs on this branch.

## Final local run

On 2026-10-30, source `8c01146e7275f1550a54c7761071fd62b3326ab8`
merged approved milestone `d16f9ac44872173c90d8c1c468f5b20ba40fd322` no-ff.
Only this note and evidenced roadmap status were edited after the source gates.
Host Node 22.22.0 and pnpm 11.0.9 match CI; Electron's main Node is 24.22.1.
All gates ran sequentially and passed first run, with no retries/skips.

| Gate | Result | Local log under `.qa/wave-5/` |
|---|---|---|
| `pnpm test:all` | 1,351 AVA; format, all three type checks, lint, Knip, audit pass | `exit-final-test-all.log` |
| `pnpm test:ava:coverage` | 97.40% lines, 10,752/11,038; configured loaded main/shared only | `exit-final-coverage.log` |
| `pnpm exec c8 check-coverage --lines 80` | Pass | `exit-final-coverage-floor.log` |
| `pnpm build` | Pass | `exit-final-build.log` |
| `env -u NANOCODER_E2E_VISIBLE pnpm test:e2e` | 189/189, including the three exit cases | `exit-final-e2e.log` |
| `env -u NANOCODER_E2E_VISIBLE NANOCODER_CLI=/tmp/nanocoder-acp-fc01e239/dist/cli.js pnpm test:acp` | 22/22 | `exit-final-acp.log` |
| Exit file with `NANOCODER_EXIT_CHECK_CLI` set to that pinned CLI, VISIBLE unset | 3/3 | `exit-final-real-perf.log` |

Every command prepended `/opt/homebrew/opt/node@22/bin` to `PATH`.
The pinned Nanocoder source is `fc01e239a80ddb2e09ca174e3c909508832d5340`.
All Electron launches used the hidden wrapper and temporary profiles; no
interactive QA launcher, port 9333, visible/native focus run or screen recording
was used. The suite's native hidden-window/Dock assertion passed.

| Metric | Local result | Boundary |
|---|---|---|
| PERF-01 | Samples 280.80/262.08/267.31/262.07/303.29 ms; median 267.31 ms | Separate real-override exit file, Nanocoder not started for this case. Fresh process/profile, unpackaged hidden build, caches not flushed. |
| PERF-02 | Pinned-real open-to-ready proxy 1,805.02 ms, investigation false | Isolated scripted config/provider, no prompt/account, native consent stubbed. Not exact spawn/initialize/preflight/MCP timing. |
| PERF-03 | 200 messages; prefix/usable 12 ms; input 3.6, scroll 6.4, frame 10, event loop 0.2 ms | Full-suite mounted fake replay, excludes startup; not model-context acceptance. |
| PERF-04 | 300 ordered updates at 104.986/s; frame 11.1, input 8.1, scroll 8.3, event loop 5.1 ms | 313 frames, five input/scroll samples; two announcement writes, 2,868.3 ms apart. |

Local machine: Apple M4, arm64 Darwin 25.5.0, 10 logical CPUs, 16 GiB,
Electron 45.1.0 and Chromium 156.0.8078.49. This is not an agreed reference
machine, a packaged build, Windows or Linux evidence.

SP-02–06 map to the exact full-suite project, thread, stream, approval,
subagent, durable-replay, import and recovery checks above. A11Y-01–05 map to
the exit journey plus app-shell, UI-foundations, palette-focus-editing,
approvals, session-import-focus and stream-announcements checks. These are
bounded macOS automated passes, not native screen-reader or full-AA approval.
The final shared report is `milestone-1/reports/milestone-1-exit-report.md`.

Retained gaps include exact-root discovery omitting upstream path aliases,
the unexplained earlier replay timeout despite later passes, and retry-screen
error text below AA (about 4.33:1 dark, 4.26:1 light). Phase 1.8 and SUB-05
remain app-composed rather than full acceptance. Proposed DEC-30/31/39,
upstream empty sessions, lossy history and missing stable child/turn IDs are
not settled by these gates. No external issue was filed or gap waived.

## Short VoiceOver acceptance

Use a deliberately approved visible fake-fixture window and an isolated
profile, never a normal profile or real account. Record platform/app/Nanocoder
versions and metadata-only pass/fail notes.

1. Enable VoiceOver. Tab through recents, thread controls and composer. Check
   names, roles, disabled reasons, reading order and a way out of each modal.
2. In normal mode, start a held fake permission and open the palette before it
   arrives. Check a useful approval announcement with no payload or stolen
   modal focus. Escape must not answer; it should focus the pending permission.
   Answer using an offered key and check composer focus returns.
3. Close the palette or shortcut sheet and continue an existing draft.
   Restored focus should be spoken once, not twice from editable-field
   blur/refocus. The draft, caret selection and slash suggestions must remain.
4. Run a theme command. Check the polite toast does not steal focus or speak
   twice. Exercise the controlled theme-save failure while an overlay is open.
5. During a long fake stream, keep editing an unsent draft. Check polite grouped
   updates rather than per-chunk flooding or repeated history. Exercise started,
   completed, failed and cancelled states. Finish a turn while opening the
   palette, then another while closing it. Each completion should be announced
   once, never lost or repeated as the live region changes host.

Record the policy tension explicitly: A11Y-02/CHAT-18 deliberately focus an
unblocked permission, whereas A11Y-04 requests announcements without focus
movement. Modal deferral and focus-on-permission after Escape are the current
behaviour, not a silent redefinition of either requirement. This macOS check
does not replace later NVDA/Orca and A11Y-06 release acceptance.
