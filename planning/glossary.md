# Glossary

Terms the planning set relies on.

- Status: Draft
- Last updated: 2026-10-23
- Drafted by: @akramcodez

| Term | Meaning |
|---|---|
| ACP | Agent Client Protocol. JSON-RPC between a client (here, the desktop) and an agent (here, `nanocoder --acp`) over stdio. |
| ACP SDK | `@agentclientprotocol/sdk`, the TypeScript implementation Nanocoder and the desktop both use. |
| ADE | Agent development environment: hand a task to an agent, then review the result. Contrasted with an IDE on [#118](https://github.com/Nano-Collective/docs/issues/118). |
| Approval | A user decision on a protected action. Nanocoder asks for workspace tools; the desktop asks for sensitive browser actions. |
| Browser-control broker | The main-process component that turns typed agent browser calls into bounded actions on the browser view. |
| Canonical root | A project's folder resolved to its real path; the basis for every security check. |
| Capability | A feature an ACP peer declares in `initialize`, such as `sessionCapabilities.close`. |
| Mode | Nanocoder's development mode: `normal`, `auto-accept`, `yolo`, `plan` or `architect`. Decides which tools ask for approval. |
| Partition | Electron's named storage area for a browser session's cookies, cache and storage. |
| Probe | A harmless call used to detect an undeclared extension method. |
| PTY | Pseudo-terminal: the operating system interface that lets a program act as a terminal for a shell. |
| Root turn | A turn the user starts. Only one runs per project process at a time. |
| Session | Nanocoder's persisted conversation, identified by a session ID and stored in its session files. |
| Session cwd | The directory passed to ACP for a session; may differ from the canonical root. |
| Snapshot | Nanocoder's pre-edit copy of a file, kept for `timeline/revert`; the proposed #109 baseline. |
| Subagent | A bounded child agent Nanocoder runs through its `agent` tool. |
| Technical gate | The proof-of-boundary test before Milestone 1: real turn, restart, resume, both approval paths. |
| Thread | The desktop's record of one chat, linked to one Nanocoder session. |
| Timeline | Nanocoder's per-session list of checkpoints taken before mutating tool calls. |
| Turn | One prompt and everything Nanocoder does until it returns a stop reason. |
| View-only | A thread whose Nanocoder session no longer exists; readable, not continuable. |
| `WebContentsView` | The Electron view type that hosts the isolated browser. |
