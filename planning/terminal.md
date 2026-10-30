# Terminal implementation

- Status: Draft
- Last updated: 2026-10-31

## Part A: host and bridge

Phases 3.1 and 3.2 provide a main-owned terminal service and typed
`window.desktop.terminal` bridge. Part B composes its user-facing bottom
dock. No terminal capability is advertised to Nanocoder (`TERM-08`).

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
- Scrollback retains at most 10,000 lines and 1,048,576 UTF-16 code units,
  with a truncation flag. Clear and stop discard it. Output uses
  acknowledgement-gated 16 ms utility-process batches, capped at 64 KiB
  of code units. Neither output nor input enters desktop storage or logs.
- POSIX stop includes descendants and every process attached to the
  main-owned PTY, across their process groups. Groups receive HUP, followed
  by forced termination after a 200 ms grace deadline. Main refreshes
  membership before delivering output and every 250 ms, retaining the
  last live membership so utility crashes cannot erase ownership.
  Forced termination always attempts all owned groups and PIDs, even when
  macOS reports EPERM for an already exited zombie group. A bounded,
  monotonic 2-second stop deadline verifies no live, non-zombie owned
  member remains. A live survivor or an unreadable/partial process table
  fails closed, and any successfully stopped survivor receives CONT.
  An exited shell cannot adopt unrelated jobs through a reused tty.
  Main then awaits utility exit and the shell PID's actual disappearance,
  each bounded to one second, before claiming stop completed.
  Windows uses the absolute system `taskkill.exe` with `/T /F`. System
  utilities never use a shell or project executable. The native module and
  spawn helper are unpacked from asar and rebuilt from source for Electron's ABI.

## Part B: terminal dock and access

The optional dock uses `@xterm/xterm` with locally bundled Fira Code and
generated theme tokens. Code ligatures and cursor blinking are off.
Opening or hiding the panel does not start or stop a shell. Start,
restart, clear and stop are explicit actions. Hiding a running terminal
keeps it running until stopped, the project changes, the renderer detaches,
or the app quits. After renderer detachment, reopen the project before
using its terminal again.

The renderer holds bounded, project-scoped display data and uses only the
typed bridge. Late responses and out-of-order events cannot restore old
project output or undo a clear. xterm writes are serialised across reset
so queued old output cannot reappear after clear. Links, including OSC 8
links, remain inert until phase 3.6. No remote resources or CSP changes
are needed.

`TERM-11` specifics are bounded local choices, not an upstream status change:

- `ctrl+shift+tab` leaves terminal input and returns focus to the terminal
  header control. Normal Tab, Escape and shell control keys remain terminal
  input. The key is shown beside the output and on the input's accessible
  description and keyboard-shortcut metadata.
- The header control explicitly returns focus to input. Closing the panel
  returns focus to its opener. Start/restart return focus only when the
  user has not moved elsewhere while the request completes.
- A visible toggle enables xterm's supported screen-reader mode and
  accessible output tree. This preference lasts only for the mounted
  panel. It changes display and announcements, never permissions or PTY
  ownership.
- xterm 6 intentionally ignores `insertText`-only input events in
  screen-reader mode. Tests use real key events in that mode, and retain
  an `insertText` path with the mode off. Dictation, IME and assistive
  input in screen-reader mode have not been checked with real assistive
  technology. VoiceOver, NVDA and native-focus QA remain manual gaps.

The agent strip is separate, escaped text with no action or routing
authority. It labels Nanocoder's reported command and approval result as
agent activity, never as input into the user's terminal (`TERM-12`).

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

`TERM-05` URL handling belongs to phase 3.6, not this host.

## Verification and limits

AVA fake-host tests cover lifecycle, stale event refusal, canonical roots,
trust, sender frames, strict IPC schemas, input bounds, shell exclusion,
environment filtering and memory limits. Hidden built-main macOS tests
start real nested Node servers which ignore HUP and TERM. They prove
stop, project switch, quit and a killed utility process leave neither
parent nor child alive. Main survives the utility crash and permits
explicit restart. A restarted terminal accepts UTF-8 text.

Part A local macOS arm64 checks on 2026-10-31:

- `pnpm test:all`: format, types, lint, AVA, Knip and audit pass.
- `pnpm test:ava:coverage`: 96.50% aggregate configured lines, above 80%.
  This is plain-Node unit coverage, not native-worker branch coverage.
- `pnpm package:dir`: source rebuild and unsigned packaging pass.
- `pnpm exec playwright test e2e/terminal.e2e.ts`: seven hidden tests pass.
  The packaged-worker test loads the actual asar worker and unpacked native
  addon/spawn helper inside a hidden test app's utility process. It does
  not launch a visible packaged app or claim signing acceptance.

Part B adds renderer controller/refusal and inert-display tests, a hidden
real-PTY UI lifecycle/focus test, accessible-tree checks, and both themes
at 1240, 1020 and 840. Fake-fixture screenshots are generated in
`.qa/terminal-ui/terminal-{dark,light}-{1240,1020,840}.png`, with rendered
text contrast and editable, unobscured composer checks.

A small-window regression keeps the original pointer-start action with
no selected conversation. At 800 by 568, the non-shrinking composer footer
previously covered the dock toolbar. The footer now shrinks and scrolls
inside the clipped conversation canvas. The test checks the start button's
centre hit target and footer/dock bounds before clicking. Approval shelf
edge-containment checks also remain required.

Part B local macOS arm64 checks on 2026-10-31:

- `pnpm test:all`: format, types, lint, 1,394 AVA tests, Knip and audit pass.
- `pnpm test:ava:coverage`: 96.85% aggregate configured line coverage.
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dir`: native source
  rebuild and unsigned packaging pass. Signing is not tested.
- The standalone hidden terminal suite passes eight tests, including the
  original pointer, keyboard, clear/restart and stop assertions.
- The loaded combined terminal/approvals/shell/projects/supervisor run
  passes 45 of 46. All 16 approval tests, all six screenshot cases,
  composer bounds/editability, rendered contrast and native server-tree
  stop/switch/quit/crash checks pass. The UI stop case remains open below.
- Fake screenshots use a temporary shell HOME and fixture prompt, not
  the user's shell startup files. Native-focus and assistive-technology
  acceptance are not claimed.

### Open: loaded UI stop failure (`TERM-07`)

Running the combined hidden suites concurrently with `pnpm test:all`
can leave the mounted lifecycle test at `failed`, with the safe reason
“The terminal process tree could not be stopped”, instead of `stopped`.
Restart and its real-keystroke output check complete before this failure.
The original stop assertion remains unchanged, with no skip, retry or
timeout increase.

The first content-free diagnostic showed all three `ps` calls exiting
successfully, followed by EPERM from a group SIGSTOP. Deterministic tests
now distinguish zombie-only groups from live survivors, verify the latter
still fails, resume successfully stopped survivors on failure, and refuse
empty/partial process snapshots or a reused tty. These checks do not
establish the remaining loaded-run cause.

The last loaded diagnostic still passed 45 of 46. It captured none of the
explicit live-survivor, invalid-snapshot or shell-not-reaped exception
messages, so the remaining utility-exit/discovery failure is unclassified.
Temporary diagnostic hooks were removed. Evidence is in
`.qa/terminal-ui/loaded-e2e.log`, `final-loaded-e2e.log` and `stage-e2e.log`;
the successful standalone run is `focus-stop-fixed.log`.
Investigation stopped at the agreed overnight limit. The loaded-stop
issue, focused teardown security review and independent UI verification
remain open; this is not full phase acceptance.

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
