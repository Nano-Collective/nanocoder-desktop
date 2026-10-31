# Projects and directory trust

Phase 1.2 implements `CHAT-01`, `CHAT-02` and the current `DEC-30` proposal.
`DEC-30` is still awaiting the founder. This does not approve or replace it.

## Main owns project identity and consent

- The native folder picker is the only source of a new root. Main resolves its
  real path, checks that it is a directory, and saves its display name and equal
  canonical root/session cwd in the desktop metadata store. Non-Git folders work.
- A canonical folder has one stored project ID and one supervisor process.
  Selecting it again reuses the project. A successful opening updates recency and
  the active project. Merely selecting it does not grant trust.
- The renderer sends project IDs, never paths or a trusted flag. The existing
  strict IPC schemas reject extra fields. A native, cancel-by-default dialog
  remains the only way to accept a Nanocoder trust refusal.
- A missing or replaced canonical root cannot open. Locate asks for another
  native selection, refuses another project's root, stops the former process
  before saving the new root, and clears trust. Existing thread history and its
  recorded cwd are not rewritten. ThreadService refuses the former session's
  cwd before resume, keeps its identity and never silently substitutes a session.
- A trust refusal clears the desktop trust flag, including when it comes from a
  direct supervisor start. A refusal does not trigger an automatic restart.

## Read-only execution summary

The native dialog names the canonical root and counts these project declarations:

- `.nanocoder/plugins/*.mjs`, hooks, MCP servers, formatters and LSP servers;
- custom tools, subscribed skills, agents and commands;
- project `.env` presence, confirmation-setting declarations and provider endpoints.

Counts deliberately do not expose command bodies, config values, endpoint URLs
or environment values. The summary never imports plugins, runs project code,
starts Git, creates sessions or installs watchers. It does not read `.env`
contents. User-level Nanocoder configuration also applies, and the dialog says
that trust is not a sandbox.

Inspection is limited to 256 KiB per declaration, 2 MiB in total, 512 directory
entries and eight nested directory levels. Files must be regular files. Relevant
paths and symlinks must resolve inside the canonical root. Broken links, malformed
metadata, YAML aliases, incomplete front matter, scan limits and changing files
refuse consent instead of producing a supposedly complete summary. Errors are
fixed messages, never parser input or filesystem error payloads.

Main holds a SHA-256 snapshot in memory and inspects again after native
acceptance. Equal-count edits still change the snapshot and refuse the grant.
Neither the snapshot nor declaration contents enter SQLite, the renderer or logs.

## Pre-trust probe exception and upstream gaps

The documented G.3 exception to `SEC-17` and `ACP-20` remains: without Nanocoder's
read-only status command, main first runs one normal `nanocoder --acp` probe to
learn its trust verdict. Nanocoder may read the project's `.env` before refusing.
The desktop does not create a session, run Git or install watchers before a ready
trust outcome.

After explicit native acceptance, only the short trust launch sets
`NANOCODER_TRUST_DIRECTORY=1`. Normal launches drop an inherited override and
never pass `--trust-directory`. The next normal launch verifies Nanocoder's
verdict; a second refusal is shown without another automatic attempt.

The desktop summary is a conservative local inspection, not Nanocoder's own
versioned fingerprint. The second inspection narrows the consent window but
cannot make Nanocoder's later grant atomic with the displayed snapshot.
Nanocoder's short trust launch can initialise project MCP before stdin closes.
The status command, fingerprint-bound grant and fingerprint versioning remain
blocked on [nanocoder#1899](https://github.com/Nano-Collective/nanocoder/issues/1899).
See [the trust integration notes](acp-integration.md#directory-trust).

On Windows, a project folder cannot be moved while Nanocoder is running in it; stop it or quit first.

The provisional minimum is `1.31.0` for an explicit `NANOCODER_DESKTOP_CLI`
override only, with an isolated, fail-closed ACP directory-trust preflight before
any selected-project launch. Published npm 1.31.0 remains unsupported. The check
neither grants trust nor replaces selected-project consent. Raise the minimum to
`1.32.0` when released and verify the artefact; `DEC-12` and `OQ-02` remain open.
See the [version policy](acp-integration.md#provisional-prototype-policy-phase-14).

The preflight awaits temporary-state cleanup before its final identity check.
It returns a main-only runtime binding, and the shared launcher synchronously
checks both Node and CLI realpaths, device, inode, size and modification time
immediately before every spawn, with no `await` between that check and spawn.
This covers normal and trust launches, recovery and idle restarts. A changed or
missing identity refuses before entering the selected project. A tiny operating
system race remains between stat and spawn; exploiting it requires same-user
write access to the chosen build. This check is not a sandbox for a malicious
executable or a replacement for file permissions.

## Renderer integration

`RecentProjects` takes only projects, active ID, pending state and add/open/locate
callbacks. `TrustFeedback` takes a feedback value. Both reuse U.1 parts and use
`source/renderer/styles/projects.css`, without assuming an app-shell layout.
`useProjects` handles the typed bridge calls. `RecentProjects` mounts in the app
shell's project-rail slot and `TrustFeedback` in its stream-tools slot. A successful
recent-project opening clears the former technical-gate composer, so it cannot
appear to target the newly selected folder. The ACP badge still follows that
project's live supervisor events, not a saved trust flag or opening result.
Default-mode controls and project removal remain unavailable here; their later
phases retain the existing IPC contracts.

## Approved workspace presentation (DEC-40)

The first-launch canvas centres the local logo, an open-folder action and known recent-project metadata. Opening and locating call the existing project-id callbacks; unavailable folders offer locate, never an unsafe open. Native trust consent and its cancel default stay in main. Trust refusals remain visible in the canvas.

Runtime paths and connected-agent/capability details live in a keyboard-native disclosure instead of preceding every conversation. Setup errors open that disclosure; version warnings stay visible outside it. The compact ready/recovery area retains explicit retry and captured-diagnostics review/export. View-only notices show metadata, the missing-history reason and desktop-only removal scope with no composer. Saved-session offers stay in their independently scoped, metadata-only list, with native import focus return unchanged.
