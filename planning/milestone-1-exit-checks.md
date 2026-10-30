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
  SUB-05 durable composition remains phase 1.8. No child hierarchy/per-child
  cancellation is inferred from display hints.
- SP-06/PERF-03: full application/child restart, exact-session replay,
  follow-up context and missing-history behaviour remain phase 1.8 acceptance.
  Earlier in-process reopen checks are not a substitute.
- A11Y-04/05: turn and rate-limited stream announcements are separate work.
  Render batching and ordered content alone do not establish speech cadence.
  Existing approval/palette/toast checks establish exposure, not spoken delivery.
- PERF-04: `streaming.e2e.ts` checks 300 ordered updates, at least 100 updates
  per second and input/scroll/frame/event-loop response within 100ms. It is a
  local fake-stream result, not general scalability or memory evidence.

The known designer-owned light approval title/Allow contrast gaps and
glyph-only incomplete checks remain. No test addition waives them.
CI definitions are not evidence of Windows/Linux runs on this branch.

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
