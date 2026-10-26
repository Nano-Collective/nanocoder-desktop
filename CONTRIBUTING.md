# Contributing to Nanocoder Desktop

Thanks for your interest in Nanocoder Desktop. Contributors of every skill level are welcome: code, documentation, design, testing and triage all count. The project is pre-v0.1, so most of the work right now is building the first version.

## Code of Conduct

Everyone taking part follows the Nano Collective [Code of Conduct](https://docs.nanocollective.org/collective/organisation/community). For anything about paid contribution, see the [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter). Neither is restated here.

What reviewers look for before merging is written up once for every Nano Collective project in [MAINTAINING.md](https://github.com/Nano-Collective/.github/blob/main/MAINTAINING.md).

## Finding work

- **Work list.** [Issue #17](https://github.com/Nano-Collective/nanocoder-desktop/issues/17) lists every phase of the [roadmap](planning/roadmap.md). Comment on it to claim a phase before you start, so two people do not build the same thing.
- **Open decisions.** Issues labelled `question` hold decisions still being made. Read the relevant one before building anything that depends on it.
- **The plan.** The [planning set](planning/index.md) covers scope, architecture, security and each feature. [DESIGN.md](DESIGN.md) covers how the app looks.

Each roadmap phase has a "Build" checklist and a "Results we want" checklist. A phase is done when every result is verified.

## Development setup

The toolchain is in place (roadmap phase S.2). The Electron app arrives in phase S.3, so for now there is nothing to launch, but you can install the project and run the full gate.

### Prerequisites

- Node.js 22 or newer.
- pnpm 11, through Corepack.
- Git.
- Nanocoder. Until the next Nanocoder release, use a build of Nanocoder `main`: published 1.31.0 does not have `session/close`, the ACP trust check or per-session working directories, which the desktop needs.
- On Linux only: Python 3, `make` and a C++ compiler, because `node-pty` has no prebuilt Linux binary and builds from source.

### Setup steps

```bash
git clone https://github.com/Nano-Collective/nanocoder-desktop.git
cd nanocoder-desktop
corepack enable
pnpm install
pnpm test:all
```

## Testing

`pnpm test:all` is the single gate, the same as every Nano Collective TypeScript project. It runs:

- `pnpm test:format`: format check with Biome
- `pnpm test:types`: type check with `tsc --noEmit`
- `pnpm test:lint`: lint check with Biome
- `pnpm test:ava`: the AVA test suite
- `pnpm test:knip`: unused files, exports and dependencies
- `pnpm test:audit`: dependency audit
- `pnpm test:security`: Semgrep, if installed

Tests use AVA through `tsx`, live in `.spec.ts` files beside the code they test, and run serially. Coverage is measured with c8, with an 80% line floor that cannot drop. The full strategy, including cross-platform and end-to-end tests, is in [`planning/testing-strategy.md`](planning/testing-strategy.md).

## Coding standards

- **Strict TypeScript.** Avoid `any`. Import from `source/` through the `@/` alias.
- **Privileged work stays in the main process.** The renderer gets data, never a capability, and every IPC method validates its input and its sender.
- **No transcripts on disk.** The desktop never stores chat messages, file contents, tool results or Nanocoder's stderr.
- **No shells.** Processes start from an absolute path with an argument array.
- **Formatting** is handled by Biome. Do not disable a lint rule without a comment saying why.
- **Writing** follows the [Brand Guidelines](https://docs.nanocollective.org/collective/organisation/brand), including British spelling in docs and UI text.

The rules behind these are in [`planning/security.md`](planning/security.md).

## Where this project differs from the Nano Collective defaults

The defaults are in [Stack Suggestions](https://docs.nanocollective.org/collective/projects/stack-suggestions) and [Project Infrastructure](https://docs.nanocollective.org/collective/projects/project-infrastructure). An Electron app needs a few things they do not cover, agreed in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3):

| Area | Here | Why |
|---|---|---|
| Build | `electron-vite`, output in `out/` | Electron needs separate main, preload and renderer builds |
| Packaging | `electron-builder`, installers on GitHub Releases, not npm | It is a desktop app, not a package |
| End-to-end tests | Playwright, against a test build with the `nodeCliInspect` fuse on | The shipped build turns that fuse off |
| Native modules | `node-pty`, built from source on Linux | The terminal needs a real PTY |
| Spec files | Linted by Biome | Nanocoder and Nanotune exclude them; we want security tests linted too |

Two more are still open: extra macOS and Windows CI jobs ([#10](https://github.com/Nano-Collective/nanocoder-desktop/issues/10)) and the visual identity ([#11](https://github.com/Nano-Collective/nanocoder-desktop/issues/11)).

## Commit messages

- `feat: <description>`: new feature
- `fix: <description>`: bug fix
- `mod: <description>`: change to existing behaviour
- `chore(deps): <description>`: dependency update
- `docs: <description>`: documentation only
- An optional scope goes in brackets, as in `feat(terminal): ...`
- Lowercase, imperative mood, no trailing full stop

## Pull requests

- Keep each pull request to one phase, or one fix.
- Say which roadmap phase it belongs to and which requirement IDs it covers (for example `CHAT-04`).
- Run `pnpm test:all` before opening it.
- Add a changeset for user-facing changes, once changesets are set up in phase S.4.
- If it changes a decision, update [`planning/decisions.md`](planning/decisions.md) in the same pull request.

## Release process

Contributors never bump versions or edit the changelog by hand; that is a maintainer task. Versions are managed with [changesets](https://github.com/changesets/changesets) in `alpha` prerelease mode: changesets build up on `main`, a bot keeps a Version Packages pull request open, and merging it starts a release. The planned stages are in [#13](https://github.com/Nano-Collective/nanocoder-desktop/issues/13) and [`planning/release-and-distribution.md`](planning/release-and-distribution.md).

## Questions

Ask in [Discord](https://discord.gg/ktPDV6rekE) or open an issue.
