# Sources

Everything read to write this planning set, with commits and the date read.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

All sources were read on 2026-10-23.

## Reference repositories

| Repository | Commit read | Notes |
|---|---|---|
| [Nano-Collective/docs](https://github.com/Nano-Collective/docs) | [`3ec3b1c`](https://github.com/Nano-Collective/docs/tree/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb) (upstream `main`), local clone at `ef22e02` | The local clone was 34 commits behind; changed files (whitepaper, brand, projects index, Scriptura) were read from upstream. |
| [Nano-Collective/nanocoder](https://github.com/Nano-Collective/nanocoder) | [`8a5f4d4`](https://github.com/Nano-Collective/nanocoder/tree/8a5f4d46317d93128c531f39b80b5ac6fd2da25b) (1.31.0), compared with [`dc8e121`](https://github.com/Nano-Collective/nanocoder/tree/dc8e121a0c4e6963df7447b9ae68491ec993679b) (1.30.0) | Upstream `main` was at `17ec32d`, three commits ahead. |
| prompt-scrub (`prompt-scrubber`) | `419b186` (local) | Conventions only. |
| Nanotune | `31be47d` (local) | Conventions only. |
| [Nano-Collective/.github](https://github.com/Nano-Collective/.github) | [`8d5dd13`](https://github.com/Nano-Collective/.github/tree/8d5dd13247a4a2e4a9937ef5448c89dae933d5ed) | Shared `pr-checks` workflow. |

## Nano Collective docs

- [Nanocoder Desktop whitepaper](https://docs.nanocollective.org/collective/whitepapers/nanocoder-desktop)
- [Scriptura whitepaper](https://docs.nanocollective.org/collective/whitepapers/scriptura)
- [How a project comes to life](https://docs.nanocollective.org/collective/projects/how-a-project-comes-to-life)
- [Creating a new project](https://docs.nanocollective.org/collective/projects/creating-a-new-project)
- [Stack suggestions](https://docs.nanocollective.org/collective/projects/stack-suggestions)
- [Project infrastructure](https://docs.nanocollective.org/collective/projects/project-infrastructure)
- [Contributing](https://docs.nanocollective.org/collective/projects/contributing)
- [Brand Guidelines](https://docs.nanocollective.org/collective/organisation/brand)
- [`lib/projects.ts`](https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/lib/projects.ts)
- [Docs site styles, `app/globals.css`](https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/app/globals.css) (read 2026-10-26)

## Issues and pull requests

Docs repository: [#107](https://github.com/Nano-Collective/docs/pull/107), [#108](https://github.com/Nano-Collective/docs/issues/108), [#109](https://github.com/Nano-Collective/docs/issues/109), [#115](https://github.com/Nano-Collective/docs/issues/115), [#116](https://github.com/Nano-Collective/docs/issues/116), [#117](https://github.com/Nano-Collective/docs/issues/117), [#118](https://github.com/Nano-Collective/docs/issues/118), [#119](https://github.com/Nano-Collective/docs/issues/119), [#120](https://github.com/Nano-Collective/docs/issues/120), [#121](https://github.com/Nano-Collective/docs/pull/121), [#122](https://github.com/Nano-Collective/docs/pull/122), commits [`60283a5`](https://github.com/Nano-Collective/docs/commit/60283a571f5536558a2becb17b973c3512cfad68) and [`7a7a620`](https://github.com/Nano-Collective/docs/commit/7a7a6208c3235d03cf59b82634d712b4aa306a5f).

Nanocoder: [#1709](https://github.com/Nano-Collective/nanocoder/pull/1709), [#1626](https://github.com/Nano-Collective/nanocoder/pull/1626), [#1730](https://github.com/Nano-Collective/nanocoder/pull/1730), [#1731](https://github.com/Nano-Collective/nanocoder/pull/1731), [#1847](https://github.com/Nano-Collective/nanocoder/pull/1847), [#1105](https://github.com/Nano-Collective/nanocoder/issues/1105), [#1689](https://github.com/Nano-Collective/nanocoder/issues/1689), [#1717](https://github.com/Nano-Collective/nanocoder/issues/1717), [#1718](https://github.com/Nano-Collective/nanocoder/issues/1718), [#1719](https://github.com/Nano-Collective/nanocoder/issues/1719), [#1721](https://github.com/Nano-Collective/nanocoder/issues/1721), [#1857](https://github.com/Nano-Collective/nanocoder/issues/1857), commits [`6dac501`](https://github.com/Nano-Collective/nanocoder/commit/6dac501756b8f17f7f83a66fdc91dfe16fd66f4a) and [`5eabeef`](https://github.com/Nano-Collective/nanocoder/commit/5eabeef74e196e7871e709b296aae3c4679ca059), and searches for `mcpServers`, `acp` and PRs by @puri-adityakumar.

## Nanocoder source files (at `8a5f4d4`)

`source/acp/` (agent, capabilities, server, session, conversation, timeline, types and specs), `source/session/session-manager.ts`, `source/session/session-paths.ts`, `source/subagents/subagent-executor.ts`, `source/services/timeline-manager.ts`, `source/constants.ts`, `source/tools/browser.tsx`, `source/tools/tool-manager.ts`, `source/config/index.ts` (including `.env` loading), `source/config/env-substitution.ts`, `source/config/preferences.ts`, `source/plain/initialize.ts`, `source/utils/ensure-nanocoder-gitignore.ts`, `source/cli.tsx`, `docs/features/acp.md`, `docs/features/hooks.md`, `docs/configuration/index.md`, `plugins/vscode/src/acp-client.ts`, `package.json`, `pnpm-workspace.yaml`, `biome.json`, `knip.json`, `tsconfig.json`, `.changeset/`, `.github/`. `@agentclientprotocol/sdk` 1.4.0 (method tables and schema types) from Nanocoder's installed dependencies.

## This repository

- [PR #1](https://github.com/Nano-Collective/nanocoder-desktop/pull/1): `DESIGN.md`, reviewed on 2026-10-26.

## Package registries and release indexes

- [npm: `@nanocollective/nanocoder`](https://www.npmjs.com/package/@nanocollective/nanocoder): latest 1.31.0, published 2026-09-26.
- npm registry metadata (`npm view <package> version license`) for every candidate in [`tech-stack.md`](tech-stack.md#electron-specific-choices).
- [Electron release index](https://releases.electronjs.org/release/v45.0.0): Electron 45.0.0 embeds Node 24.22.0 and Chromium 156.

## External documentation

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)
- [ACP extensibility](https://agentclientprotocol.com/protocol/extensibility)
- [Git status, porcelain format version 2](https://git-scm.com/docs/git-status#_porcelain_format_version_2)

## Tried and not confirmed

- electron-builder's auto-update documentation (two URLs returned 404). Which Linux formats `electron-updater` can update stays Unverified.
