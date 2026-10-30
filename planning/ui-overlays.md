# Workspace overlays

- Status: implemented for U.12 in issue #17
- Last updated: 2026-10-29

Visual design: see [`DESIGN.md`](../DESIGN.md).

## Behaviour

The renderer owns the command palette, keyboard shortcut sheet and notification
queue. They add no IPC channels or preload capabilities.

- `⌘K` on macOS, or `Ctrl+K` elsewhere, opens the palette. Query words filter
  labels and keywords, with exact labels before prefixes, label words and
  keywords. Equal matches keep their original order.
- The palette lists only existing actions. Unavailable actions remain visible
  with their reason and cannot run. Arrow keys include unavailable rows so their
  reasons can be read. Enter runs the selected available action.
  With long project lists, selection scrolls into view while the search input
  and close control stay above the scrolling results.
- `?` opens the shortcut sheet outside text fields. Typing `?` in a message,
  command search or editable field does not open it.
- Keys used during IME composition, including composing Escape and legacy
  key-code 229, do not close an overlay or execute a command.
- Native modal dialogs keep the background inert. Escape closes from every
  control, including an empty search. The close button and backdrop also close.
  Focus returns to the original control, or the palette button if that control
  was removed or disabled (`A11Y-01`, `A11Y-03`). Return waits for the native
  close event and respects focus already recovered by a pending approval.
- Theme actions save through the existing settings method before changing the
  renderer. Success is announced only after the setting is saved.
- Notifications never take focus. A persistent polite, atomic live region
  announces one queued notification at a time. Each has 2400ms to read before
  its 180ms exit. An injected clock tests time without sleeps. Reduced motion
  disables the transition.
- Notification regions remain mounted outside and inside the native dialog.
  Only the non-inert layer is active. While an overlay is open, its region
  announces the waiting approval count without request content, and focus
  stays in the overlay. Closing it lets the pending approval recover focus.
  Browser tests prove region identity before and after the text change;
  VoiceOver delivery remains part of the manual accessibility checklist.
- Theme-save failures use that same active polite region, without a separate
  alert in the inert background. Deferred-save tests cover a closed overlay
  and either reopened modal, with one message, the original region and no
  focus change.

The action set adds a project folder, opens a recent project, locates a moved
project, opens the existing technical-session folder flow, switches to dark or
light theme, and opens the keyboard shortcut sheet. Project commands use
`useProjects` callbacks (`CHAT-01`, `CHAT-02`). Missing or replaced folders keep
their open command visible with a locate-first reason. A pending project request
disables every project command. Canonical roots distinguish projects with the
same name and are searchable, without passing any new paths to main.

## Verification

`source/renderer/overlay-model.spec.ts` covers matching, ranking, keyboard
selection, disabled refusal, focus return and notification timing.
`e2e/overlays.e2e.ts` covers built-app keyboard actions, settings persistence,
native picker cancellation, unavailable-runtime refusal, all three widths in
both themes, reduced motion and notification focus/live-region behaviour.

This supports the overlay portions of `A11Y-01` and `A11Y-03`; it does not claim
screen-reader acceptance or completion of whole-app accessibility requirements.
