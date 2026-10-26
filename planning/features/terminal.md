# Terminal

The single project terminal.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## Purpose

Let the user run, test and inspect the project in one PTY tied to the project root ([whitepaper, Integrated terminal][wp-term]). It is a user terminal, not an agent execution path: Nanocoder's own command tools keep using Nanocoder's approval policy. Visual design: see [`DESIGN.md`](../../DESIGN.md).

## v1 requirements

| ID | Requirement | Status and source |
|---|---|---|
| TERM-01 | One PTY per active project, started in the canonical root. | Decided ([whitepaper][wp-term]) |
| TERM-02 | Start, stop, restart and resize. | Decided ([whitepaper][wp-term]) |
| TERM-03 | Use the user's configured shell, found per platform, launched by absolute path. | Decided ([whitepaper][wp-term]) |
| TERM-04 | Interactive input with UTF-8 handling. | Decided ([whitepaper][wp-term]) |
| TERM-05 | Detect localhost URLs in output and open them in the in-app browser; other URLs open externally after confirmation (`SEC-16`). | Decided for localhost ([whitepaper][wp-term]); external handling Suggestion (not discussed) |
| TERM-06 | Explicit output clearing. | Decided ([whitepaper][wp-term]) |
| TERM-07 | Stop ends the whole process tree, on stop, project switch and app quit. | Decided ([whitepaper][wp-term]) |
| TERM-08 | The agent cannot read or write this terminal; the desktop offers no ACP terminal capability. | Decided ([whitepaper][wp-term], [Why ACP][wp-why]) |
| TERM-09 | Scrollback is bounded and in memory only. | Decided (persisted scrollback is later work, [whitepaper][wp-term]) |
| TERM-10 | Start the shell as a login shell where that is the platform norm, so the user's usual `PATH` applies. | Suggestion (not discussed) |
| TERM-11 | Keyboard focus can always leave the terminal with a documented key, and a screen-reader mode is available (`A11Y-01`). | Decided as a v1 goal ([whitepaper, Milestone 4][wp-next]); specifics Suggestion (not discussed) |
| TERM-12 | Above the terminal output, show the agent's most recent shell command (from Nanocoder's `execute_bash` tool calls) and its approval result, labelled as the agent's, so it is never mistaken for input typed into this terminal. | Proposed (awaiting @will-lamerton) ([`DESIGN.md`](../../DESIGN.md#terminal), [PR #1][pr1]) |

## Behaviour

### Shell discovery

Suggestion (not discussed). Resolved once per launch to an absolute path and shown to the user, with a setting to override it.

| Platform | Order |
|---|---|
| macOS | The account's login shell from the user database, then `SHELL`, then `/bin/zsh`. Started as a login shell. |
| Linux | The account's login shell from the user database, then `SHELL`, then `/bin/bash`, then `/bin/sh`. |
| Windows | PowerShell 7 (`pwsh.exe`) if installed, then Windows PowerShell, then `COMSPEC` (`cmd.exe`). |

### States

| State | Meaning | Actions offered |
|---|---|---|
| Stopped | No PTY | Start |
| Starting | PTY spawned, shell not yet producing output | Stop |
| Running | Shell alive | Type, resize, clear, stop, restart |
| Exited | Shell ended by itself, with its exit code | Restart, clear |
| Failed | The PTY or shell could not start; the reason is shown | Retry, change shell |

### Stopping a process tree

Suggestion (not discussed):

- **macOS and Linux.** Send `SIGHUP` to the PTY's process group, then `SIGTERM` after 2 seconds, then `SIGKILL` after 3 more. Report any process still alive by PID and name.
- **Windows.** Close the ConPTY, then end the remaining tree by process ID. Nanocoder had to fix tree kills on Windows for its own bash tool ([changeset][nc-windows-kill]); reuse its lessons.

### URL detection

Detect `http://` and `https://` URLs whose host is `localhost`, a `.localhost` name, `127.0.0.1`, `[::1]` or `0.0.0.0` (rewritten to `localhost`), with any port. Strip ANSI sequences and trailing punctuation before matching. Other URLs are shown as external links that ask before opening (`SEC-16`).

### Scrollback

Suggestion (not discussed): 10,000 lines, in memory, cleared on stop and never written to disk.

## Explicit deferrals

Multiple terminal tabs, persisted scrollback, remote terminals, automatic server detection ([whitepaper][wp-term]), and sending terminal output to the chat.

## Edge cases and failure modes

- A dev server that ignores `SIGTERM`: escalation as above.
- Child processes that detach from the PTY (daemons, `nohup`): tree teardown, then report survivors.
- Very fast output: throttle rendering and keep the bounded buffer.
- Shell missing or misconfigured: fall back to the next candidate and say so.
- The project root deleted while the terminal runs: the shell keeps running; the terminal says the directory is gone.
- App quit while a server runs: stop it as part of quitting, and do not leave the quit waiting more than 5 seconds.

## Platform notes

- **Windows.** ConPTY behaviour, PowerShell versus `cmd.exe` quoting, process tree teardown without POSIX signals, and code page handling (force UTF-8 where the shell allows it).
- **macOS.** A GUI-launched app does not run the user's shell profile, which is why the shell starts as a login shell (`TERM-10`).
- **Linux.** Desktop environments differ in how they set `SHELL` for GUI apps; the user database is the more reliable source.

## Security notes

`SEC-05` (shell launch by absolute path, argument array). The terminal runs with the user's privileges, which is out of the threat model by design ([`security.md`](../security.md#out-of-scope)).

## Dependencies on Nanocoder changes

None.

## Open questions

`OQ-05` (PTY library).

## Acceptance criteria

| Criterion | Success item |
|---|---|
| A development server starts in the terminal and its localhost URL opens in the in-app browser. | `SP-10` |
| Stopping the terminal leaves no orphaned server process on all three platforms. | `SP-10` |
| Focus can leave the terminal with the keyboard alone (`A11Y-01`). | `SP-10` |

[wp-term]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L454-L471
[wp-why]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L267-L275
[wp-next]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L650-L696
[pr1]: https://github.com/Nano-Collective/nanocoder-desktop/pull/1
[nc-windows-kill]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/.changeset/windows-bash-kill-tree.md
