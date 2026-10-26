# nc-review rubric for Nanocoder Desktop

What this project cares about, on top of the shared method. Where the two disagree, this file wins.

## What this project is

An Electron desktop workspace that drives Nanocoder over ACP (`nanocoder --acp`). It adds no agent of its own: Nanocoder owns models, prompts, tools, approvals and chat history. The plan is in `planning/`; read `planning/architecture.md` and `planning/security.md` before judging a change.

## Trust boundaries

Most real bugs here are boundary bugs. Flag any change that:

- gives the renderer Node, `ipcRenderer` or any capability, or turns off `sandbox`, `contextIsolation` or `webSecurity`;
- adds an IPC handler without schema validation and a sender check;
- loads the renderer from `file://`, loosens the Content Security Policy, or allows navigation, new windows or `<webview>`;
- reads, lists or serves a path without canonicalising it and checking it stays inside the project root;
- starts a process through a shell, a string command or a PATH lookup instead of an absolute path and an argument array;
- writes chat messages, file contents, tool results, Nanocoder's stderr or any secret to disk or logs;
- gives the browser view a preload, Node or IPC.

## Public contracts

- The preload API (`window.desktop`) and the IPC channel types in `source/shared/`.
- How the app talks to Nanocoder over ACP: method names, capability checks and the version policy in `planning/acp-integration.md`.
- The SQLite schema and its migrations.

## Tests

- Security rules need tests that prove the refusal, not just the happy path.
- Logic belongs in modules AVA can test in plain Node; Electron entry files stay thin.
- ACP integration tests are `*.acp.ts` and run against a real `nanocoder --acp`.
- Tests never sleep for a fixed time.

## Scope

- One roadmap phase or one fix per pull request, with its requirement IDs.
- A change to a decision updates `planning/decisions.md` in the same pull request.
- Visual design is `DESIGN.md`'s job, not the planning set's.
- Code comments are rare: one line, only where the reason is not obvious.
