# Terminal implementation

- Status: Draft
- Last updated: 2026-10-31

## Part A: host and bridge

Phases 3.1 and 3.2 provide a main-owned terminal service and typed
`window.desktop.terminal` bridge. The renderer UI is a separate composition
step. No terminal capability is advertised to Nanocoder (`TERM-08`).

- `node-pty` runs only in an Electron utility process. Its native failure
  cannot crash main. Main retains ownership of the shell PID and teardown.
- An explicit terminal start requires the active, trusted stored project,
  its unchanged canonical root and an available shell outside every
  stored project root (`TERM-01`, `SEC-03`, `SEC-05`, `SEC-17`).
- Project opening waits for the previous terminal to stop. Renderer
  detachment and orderly app quit also stop it. A stale pending start
  cannot publish or remain alive after a switch.
- Input is bounded to 65,536 UTF-16 code units per request, with malformed
  surrogate pairs refused. Dimensions are integers from 2 to 500.
- Scrollback retains at most 10,000 lines and 1 MiB of UTF-16 code units,
  with a truncation flag. Clear and stop discard it. Output uses
  acknowledgement-gated 16 ms utility-process batches, capped at 64 KiB
  of code units. Neither output nor input enters desktop storage or logs.
- POSIX stop snapshots descendants, including different process groups,
  freezes them, and forcibly ends the leaves and shell. Windows uses the
  absolute system `taskkill.exe` with `/T /F`. System utilities never use
  a shell or project executable. This is intentionally immediate teardown,
  not a promise that applications receive a graceful shutdown.

## Bounded local details, not upstream policy changes

`TERM-10` remains Suggestion (not discussed). The local implementation uses
the account shell, then absolute `SHELL`, then fixed platform fallbacks.
Known POSIX shells receive `-l`. Windows uses absolute ComSpec or fixed
PowerShell locations with fixed argument arrays. No PATH lookup occurs.
Loader injection and inherited Nanocoder trust variables are removed.

`TERM-12` remains Proposed (awaiting @will-lamerton). Its display-only
metadata will observe already mapped main-process tool and permission
events. It cannot read, write or execute in the user's terminal.

`TERM-11` keyboard escape and screen-reader mode await renderer composition.
`TERM-05` URL handling belongs to phase 3.6, not this host.

## Verification and limits

AVA fake-host tests cover lifecycle, stale event refusal, canonical roots,
trust, sender frames, strict IPC schemas, input bounds, shell exclusion,
environment filtering and memory limits. The hidden built-main macOS test
starts a real server which ignores HUP and TERM, then proves stop leaves
no live server PID. A restarted terminal accepts UTF-8 text.

All-platform acceptance is not established by local macOS checks. A
process that daemonises and reparents before teardown discovery is not
guaranteed to remain attributable to the terminal by a portable PID tree.
PID reuse, filesystem replacement races and abrupt OS termination remain
limitations, not claims of process sandboxing. User-selected shells may
also independently write their own history or application files; the
desktop itself does not persist terminal content.
