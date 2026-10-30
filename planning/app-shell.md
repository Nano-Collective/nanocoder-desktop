# App shell

Implementation notes for U.2 from [work list #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17).

- Status: Draft
- Last updated: 2026-10-31

Visual decisions remain in [`DESIGN.md`](../DESIGN.md). The M1 workspace follows the user-approved revision-4 overhaul (`DEC-40`).

## Composition

`source/renderer/app-shell.tsx` owns compact project/thread navigation, the conversation header, independently scrolling transcript, pinned composer and optional workbench/bottom slots. Ordinary React children fill the slots; no capability or authority moves into the renderer. Unused later slots mount nothing and show no placeholder.

The compact project switcher retains recent-root, add and locate actions. Thread-title filtering uses only the active project's in-memory desktop metadata, with no transcript index or cross-project search. Today/earlier ordering stays last activity; archive stays separate. The selected thread reports its state in words as well as a glyph. Search resets with project scope.

At 1240/1020/840 the sidebar is 222/204/188px. Reading content and the composer share a constrained centred column. An open workbench stays beside chat above 840px, then takes the conversation canvas at 840px and below with a back-to-chat action. Project navigation remains reachable. The optional terminal slot stays absent in M1.

## ACP status

`supervisor-state.ts` consumes existing project-scoped supervisor events. The state index retains canonical-root identity when an exit clears the agent, rejects old/duplicate sequences and inconsistent project IDs, and tombstones removed projects against stale replay. Root lookup ignores those tombstones, so adding the same folder under a new project ID uses the new project's state. Sequences remain scoped to each project, not compared across project IDs.

The title bar derives ACP ready/exited from the selected project's current supervisor state, not its historical connect result or prompt error. Only ready with an agent produces ready. A stopped/failed process with a reported exit produces exited, showing the actual numeric code when present. Signal-only exits do not invent a code. Other states show no ACP claim. A real ready event after reconnect restores ready. A failed provider turn does not itself imply that the process exited.

The turn badge retains the existing derivation from pending permissions, running prompts and turn/open results. It is independent of the process badge, so a failed turn and a genuinely ready process can appear together.

## Tests and QA

Pure state tests are beside the reducer. Built-app tests cover real child exit, provider errors, cancelled selection, project isolation and replay on reopen. Logic follows red, green, refactor; the hand-back report records each test's red and green run.

Layout tests cover 1240, 1020, 840 and the exact 839/841 breakpoint, pinned composer, overflow, independently scrolling content and unused-slot absence in both themes. Keyboard checks retain project/thread, composer and Nanocoder approval focus assertions, with the switcher and title filter added to the actual order. Native focus and screen-reader acceptance remain separate platform QA.

Captures use the hidden Electron wrapper, fake Nanocoder and temporary profiles, without port 9333. All approved rendered token pairings pass AA without the old design exceptions. See [foundations](ui-foundations.md).
