# Screen-reader protocol (A11Y-06)

- Status: Draft
- Last updated: 2026-11-12
- Drafted by: @akramcodez

Each release, the main screen reader on each platform completes four success items. This is the script and the results table. It is run by a person, and a run is recorded in the release pull request (`A11Y-06`). The automated checks in [`accessibility-review.md`](accessibility-review.md) do not replace it.

| Platform | Screen reader | Notes |
|---|---|---|
| macOS | VoiceOver (turn on with Cmd+F5) | Keep the VoiceOver cursor on the app window and use the keyboard |
| Windows | NVDA, current release | Switch between browse mode and focus mode as NVDA offers, and record which one each step needed |
| Linux | Orca, on a desktop that supports it (GNOME) | How well Orca reads Electron apps is not known; the first run will show |

## Before each run

1. Install the release candidate, or run `pnpm dev`.
2. Open a small project folder that is a Git repository, with one changed file, one long file (about 300 lines) and one long diff.
3. Turn the screen reader on and leave the mouse alone. Everything below is done with the keyboard.
4. Write down the screen reader's name and version and the operating system version.

## The four items

For each step, record Pass, Partial (what was missing) or Fail (what went wrong). Do not skip a step because it looks fine.

### `SP-03`: a chat with streaming and tool activity

1. Move to the message box. The screen reader says what it is ("message", edit text).
2. Type a message that makes Nanocoder use a tool, and send it.
3. While the answer streams, the screen reader announces progress at a calm pace, not every chunk, and does not interrupt what you are doing.
4. When the turn finishes, you are told it finished, and focus has not moved.
5. Read the finished answer and the tool activity line by line. Each can be read in order, and tool rows say what they are.

### `SP-04`: approve or reject a protected operation

1. Make Nanocoder ask for approval (use `normal` mode and a file edit).
2. The request is announced as soon as it appears, and focus moves to it.
3. Each option is read with its name, and the keyboard shortcut is stated or discoverable.
4. Choose one. Focus returns to where it was, and the outcome is announced.
5. Repeat and reject. The rejection is clear, and the turn goes on.

### `SP-07`: browse and preview project files

1. Open the files panel and move into the tree. The screen reader says it is a tree, and reads each item with its level and whether it is open.
2. Open and close a folder with the arrow keys. The change is announced.
3. Open the 300 line file. Read it from the top, then jump to the end and read the last lines. **The lines past the first screen must be readable**: the editor draws only what is visible, so this is the step most likely to fail.
4. Open a binary file and an oversized one. The reason is read instead of a blank panel.

### `SP-08`: review the repository's Git diff

1. Open the review panel. The changed file is listed with its state (staged, unstaged, modified).
2. Open the file's diff. The screen reader reads added and removed lines in a way that tells them apart, not only the text.
3. Open the long diff and read to the end. Lines past the first screen must be readable.
4. Add a review comment by keyboard and send it.

## Recording a run

Copy this table into the release pull request.

| Platform and reader | Version | `SP-03` | `SP-04` | `SP-07` | `SP-08` | Notes and filed issues |
|---|---|---|---|---|---|---|
| macOS, VoiceOver | | | | | | |
| Windows, NVDA | | | | | | |
| Linux, Orca | | | | | | |

Anything marked Partial or Fail is fixed in the release or filed with a milestone before the release is tagged. The roadmap item "issues found are fixed or filed" is ticked only when that is true for the run.
