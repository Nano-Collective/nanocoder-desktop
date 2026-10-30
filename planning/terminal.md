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
- POSIX stop includes descendants and every process attached to the
  main-owned PTY, across their process groups. Groups receive HUP, followed
  by forced termination after a 200 ms grace deadline. Main refreshes
  membership before delivering output and every 250 ms, retaining the
  last live membership so utility crashes cannot erase ownership.
  Windows uses the
  absolute system `taskkill.exe` with `/T /F`. System utilities never use
  a shell or project executable. The native module and spawn helper are
  unpacked from asar and rebuilt from source for Electron's ABI.

## Bounded local details, not upstream policy changes

`TERM-10` remains Suggestion (not discussed). The local implementation uses
the account shell, then absolute `SHELL`, then fixed platform fallbacks.
Known POSIX shells receive `-l`. Windows uses absolute ComSpec or fixed
PowerShell locations with fixed argument arrays. No PATH lookup occurs.
Loader injection and inherited Nanocoder trust variables are removed.

`TERM-12` remains Proposed (awaiting @will-lamerton). Its display-only
metadata observes already mapped main-process tool and permission events.
Only explicit `execute_bash: ...` labels populate it. Accepted answers are
matched to the same thread's main-owned offered option, after the existing
permission service accepts that answer. A closed request without a known
accepted answer reports unknown, never approved. The projection ignores
replay, caps commands at 4,096 code units and cannot read, write or execute
in the user's terminal. Missing upstream command data leaves it empty.

`TERM-11` keyboard escape and screen-reader mode await renderer composition.
`TERM-05` URL handling belongs to phase 3.6, not this host.

## Verification and limits

AVA fake-host tests cover lifecycle, stale event refusal, canonical roots,
trust, sender frames, strict IPC schemas, input bounds, shell exclusion,
environment filtering and memory limits. Hidden built-main macOS tests
start real nested Node servers which ignore HUP and TERM. They prove
stop, project switch, quit and a killed utility process leave neither
parent nor child alive. Main survives the utility crash and permits
explicit restart. A restarted terminal accepts UTF-8 text.

All-platform acceptance is not established by local macOS checks. A
process that deliberately leaves its terminal session, for example through
`setsid` or a double fork, can escape portable PTY membership discovery.
Such an independently daemonised process may keep running after the
terminal says stopped; the terminal does not claim to sandbox it.
`node-pty` 1.1 has no public Windows Job Object or kill-on-close option.
Windows therefore uses a forced process-tree kill, not a claim that
breakaway processes are contained in a job.
PID reuse, filesystem replacement races and abrupt OS termination remain
limitations, not claims of process sandboxing. User-selected shells may
also independently write their own history or application files; the
desktop itself does not persist terminal content.
