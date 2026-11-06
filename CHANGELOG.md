# @nanocollective/nanocoder-desktop

# 0.1.0-alpha.0

- Match the approved revision-4 design across the workspace: the sidebar and project switcher, header thread actions, conversation and composer, approval shelf, one shared dialog shell, first launch, saved-session import and recovery pages. Render Markdown tables, strikethrough and task lists inertly. Let a view-only thread retry its own saved session, and offer a new thread after a failed process.
- Show another project's running, waiting, finished or failed turn in the sidebar, with a notification when the window is in the background, and ask before quitting or closing a window with an unfinished turn.
- Recover crashed Nanocoder processes with bounded retries, close idle sessions safely, and review redacted diagnostics before exporting an exact captured snapshot.

Keep recovery tied to the selected stored project, finish session preparation after an initial retry, and preserve conversation and historical failures. Diagnostics fail closed to recognised metadata, including after an initialisation crash.
- Make the in-app browser safer and more useful. Pages can no longer open file pickers or new windows, downloads ask where to save and are listed, each project can use its own, a shared, a named or an incognito browser profile, a profile's data can be cleared, and the current page can be opened in the system browser after a confirmation.
- Open localhost addresses in the in-app browser from the terminal and from chat, with a button in the terminal for the newest dev server address, and send the browser's current page address and title to the next message.
- Add the in-app browser tab to the workbench. It has an address bar with back, forward, reload and stop, shows the page origin and whether it is secure, and opens only localhost pages unless public sites are turned on. A redirect or link to a public site stops and asks first.
- Add the responsive app shell and show ACP readiness from the supervised process state, including after removing and re-adding the same project folder.
- Show Nanocoder's approval choices with keyboard focus and scoped shortcuts, and allow cancelling a turn while approval is pending.
- Persist desktop settings and bounded window/panel state in a local SQLite metadata store, with migration backups and corruption recovery.
- Add recent projects with canonical folder paths, native execution-sensitive trust summaries and moved-folder location. Refuse changed trust summaries and never resume a cached session from a project's former working directory.
- Add a files and review panel. Browse the project one folder at a time, preview text with highlighting, and see Git's real status and diffs, with the files the last turn edited labelled. Attach a file or a comment on selected diff lines to the next message, open files in your editor, and let Nanocoder read project files through a checked, read-only handler. Nothing here edits, stages or commits.
- Add a project terminal with explicit start, stop, restart and clear, bounded memory-only scrollback, and keyboard and screen-reader access. Keep reported Nanocoder command activity separately labelled and display-only.
- Run Nanocoder separately for each project, refuse unsupported versions, and explain unavailable features.
- Add dark and light UI foundations, a bundled Fira Code font, shared controls and reduced-motion support to the technical-gate screen.
- Add a keyboard command palette, shortcut sheet and polite, queued notifications.
- Compose project-scoped thread controls, memory-only conversations and editable drafts. Connect without opening history, save the real session identity before the first turn, and route approvals and cancellation through the owning thread.

- Accept the distinct exit code that newer Nanocoder builds use for a directory trust refusal, so a development build that has it can still pass the trust check.
- Commit structural replay identities and safe subagent metadata before replacing a thread's readable history.

Keep the old prefix on storage failure, retry only the saved session, and stop treating synthetic historical tool completion as proven success.
- Bound saved-history replay to its exact session and safe memory limits. Keep sending and controls unavailable until its committed prefix is displayed, retain unqueued drafts, and explain retryable or missing-history failures.
- Add the main-owned browser view foundation: a sandboxed view with its own persistent storage for each project, no access to desktop APIs, permissions denied, and only localhost pages allowed for now. It has no interface yet.
- Restore composer editing after closing the command palette or shortcut sheet.
- Show bounded subagent progress cards, attributed approvals and whole-turn stop without inventing child controls or successful execution results.
- Mark unfinished thread metadata as interrupted after desktop restart, keeping saved identities and titles without reviving old approval requests.
- Commit live turn and tool identities with safe subagent metadata before publishing their events.

Keep known failures and interruptions truthful across structural replay, and refuse partial tool or terminal publication when metadata cannot commit.
- Keep failed theme saves in the active notification layer when the palette or shortcut sheet is reopened.
- Refuse case-aliased project runtimes, recover cleanly from failed session resumes, and cancel hidden approvals when the app renderer detaches.
- Add project-wide model controls, acknowledged thread modes, cancel-default native yolo confirmation and a multiline composer without preparing a session before the first message.
- Serialise thread preparation with control hooks and safely resume a session when its ready offers or acknowledged live mode are unavailable.
- Announce turn states and bounded finished responses politely without reading each streamed token, moving focus or duplicating modal approval speech.
- Preserve generated thread titles accepted during prompt preparation, recovery and turn completion without replacing newer metadata.
- Keep the earlier pending thread mode usable when yolo confirmation is cancelled.
- Allow Nanocoder 1.31.x development builds through an explicit CLI override only
after an isolated ACP trust check. Published 1.31.0 remains unsupported, and normal
project trust consent is unchanged. Raise the minimum to 1.32.0 when released.
- Refresh project model controls when the current ready Nanocoder session reports a valid config change, without another controls read. Ignore malformed, empty, replayed, replaced and disposed notifications, and retain pending modes and config uncertainty.
- Remove cancelled approval payloads from retained memory snapshots when the renderer detaches, so reopening cannot revive hidden permission cards.
- Allow explicit Retry after an inconclusive development-build trust preflight
without accepting an unverified runtime. Keep definitive rejections cached,
fence stale results across projects and preserve native project trust consent.
- Refuse project-local runtimes in two-dot-prefixed folders and renderer files that escape through symlinks.
- Offer saved Nanocoder sessions for explicit import in their exact project root. Import desktop metadata only, preserve existing thread ownership and archive state, and resume history only when the user opens the imported thread.

Keep focus in the composer if the user moves there during import. Keyboard-only focus return stays within the project that began the import.
- Keep reported usage and outcomes within their own turn, including turns with no agent answer.
- Serialise thread mutations with mode, config and prompt preparation while keeping offline metadata actions available.

Keep permission answers and cancellation with their active turn, and prevent late history confirmations or ACP acknowledgements from mutating a replaced scope.
- Show streamed reasoning, tool details, reported usage and custom command suggestions with safe Markdown and ordered rendering batches.
- Add bounded metadata-only thread identities and atomic replay staging as a foundation for durable resume.

Refuse malformed Nanocoder session identities before saving, importing or accepting replay, without changing valid Unicode IDs.
- Show ANSI colours and the cursor in the project terminal. They were dropped because the strict style policy blocked the styles the terminal library injects.
- Keep long thread titles inside the project rail without hiding their state glyph or selected rule during keyboard navigation.
- Distinguish missing saved history from retryable resume failures. Keep missing threads view-only with a clear notice and desktop recovery actions. Retry the same saved thread explicitly without sending its draft or creating a replacement session.
