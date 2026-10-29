# App shell

Implementation notes for U.2 from [work list #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

- Status: Draft
- Last updated: 2026-10-29

Visual decisions remain in [`DESIGN.md`](../DESIGN.md). The shell contains the existing technical gate, not a complete thread workspace.

## Composition

`source/renderer/app-shell.tsx` owns the title bar, project rail, stream scroll region, pinned composer and inspector. `projectRail`, `streamTools`, `composer`, `statusBadges` and `children` accept ordinary React children. Project/trust and diagnostics components can move into the first two slots without changing their props or styles. The slots are also identified by `data-shell-slot` attributes.

Session tabs, project/thread lists, files/review and the palette shortcut are static placeholders. They say “not built yet” and expose no pretend action or tab-selection state. Functional thread tabs/rail, inspector tools, the palette and the bottom panel remain with their later phases.

The transcript, permission cards and turn results stay in the stream's scroll region. Runtime discovery, the native folder/trust flow, connection details and capability reasons stay in `streamTools`. The existing composer stays outside the scroll region, pinned to its bottom. Long runtime paths and content wrap inside the flexible stream rather than expanding the desktop.

## ACP status

`supervisor-state.ts` consumes existing project-scoped supervisor events. The state index retains canonical-root identity when an exit clears the agent, rejects old/duplicate sequences and inconsistent project IDs, and tombstones removed projects against stale replay. Root lookup ignores those tombstones, so adding the same folder under a new project ID uses the new project's state. Sequences remain scoped to each project, not compared across project IDs.

The title bar derives ACP ready/exited from the selected project's current supervisor state, not its historical connect result or prompt error. Only ready with an agent produces ready. A stopped/failed process with a reported exit produces exited, showing the actual numeric code when present. Signal-only exits do not invent a code. Other states show no ACP claim. A real ready event after reconnect restores ready. A failed provider turn does not itself imply that the process exited.

The turn badge retains the existing derivation from pending permissions, running prompts and turn/open results. It is independent of the process badge, so a failed turn and a genuinely ready process can appear together.

## Tests and QA

Pure state tests are beside the reducer. Built-app tests cover real child exit, provider errors, cancelled selection, project isolation and replay on reopen. Logic follows red, green, refactor; the hand-back report records each test's red and green run.

Layout tests check 190px/240px regions and the bottom-pinned composer at 1240, 1020 and 840px in both themes, including overflow and a long scroll region. They also check the exact 840px breakpoint at 839 and 841px. Keyboard checks cover open, message, send and Nanocoder's approval choices in both themes at every target width. They do not claim automatic permission-focus transfer.

Use the [foundation QA steps](ui-foundations.md#themes-and-qa), with these additions:

1. Acquire the shared QA launcher lock with `mkdir /tmp/nc-m1-qa.lock`. If it exists, do other work and retry later.
2. Build and launch from this lane only. Capture both themes at 1240, 1020 and 840px under `.qa/wave-2/`, along with keyboard focus and agent-browser a11y evidence. Use fake Nanocoder only, with no persisted conversation or diagnostics contents.
3. Wait for the target root background and every descendant `CSSTransition` to finish before measuring or capturing. Recheck reduced motion and actual rendered-text contrast.
4. Stop the printed launcher PID, verify port 9333 has no listener, then release the lock with `rmdir /tmp/nc-m1-qa.lock`.

Existing documented design contrast gaps remain visible in audit reports, not silently waived or adjusted. This phase supports `A11Y-01` to `A11Y-03`, but does not claim full permission-focus management, stream announcements or platform screen-reader acceptance.
