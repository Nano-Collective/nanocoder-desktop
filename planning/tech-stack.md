# Tech stack

The decided stack, the NC toolchain defaults as they exist in Nanocoder, prompt-scrub and Nanotune, and the Electron-specific choices still open.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## Decided stack

Decided ([whitepaper, Recommendation: Electron][wp-alt]): Electron, React, TypeScript, the ACP SDK (`@agentclientprotocol/sdk`, Apache-2.0), SQLite (acceptance Open, `OQ-04`), a supervised Nanocoder child, system Git, a PTY, and an isolated `WebContentsView` behind a typed browser-control adapter.

Recorded alternative: Tauri v2, with a Rust core, an OS webview and Nanocoder as a sidecar. Choose it only if measured installer or memory targets become a release gate (Decided, same source).

### Versions at the time of writing

Checked against the npm registry and [Electron's release index][el-releases] on 2026-10-23. These are facts about today, not pins; the pins are chosen at scaffold time.

| Package | Latest | Licence | Note |
|---|---|---|---|
| `electron` | 45.0.0 | MIT | Embeds Node 24.22.0 and Chromium 156. Electron 41 to 45 all embed Node 24, which meets Nanocoder's `>=22`. |
| `react` | 19.3.1 | MIT | |
| `@agentclientprotocol/sdk` | 1.4.0 (as resolved by Nanocoder) | Apache-2.0 | Use the same minor as the bundled Nanocoder. |
| `@nanocollective/nanocoder` | 1.31.0 (published 2026-09-26) | MIT | Predates the ACP fixes the desktop needs ([`acp-integration.md`](acp-integration.md#supported-nanocoder-versions)). |

## NC toolchain defaults

What the three reference repositories actually do (read on 2026-10-23), against the NC docs ([Stack suggestions][stack], [Project infrastructure][infra]).

| Setting | Nanocoder | prompt-scrub | Nanotune | NC docs | Use for desktop |
|---|---|---|---|---|---|
| `packageManager` | `pnpm@11.0.9` | `pnpm@11.0.9` | `pnpm@11.0.9` | pnpm 10+ | pnpm 11 (all three agree) |
| `engines.node` | `>=22` | `>=22` | `>=22.0.0` | 20+, 22 in CI | `>=22` |
| Module type | ESM | ESM | ESM | ESM | ESM |
| TypeScript `strict` | on | on | on | on | on |
| TypeScript target | `ES2022` | `esnext` | `ES2022` | ESNext | Per bundler; the docs and two repos differ |
| `@/*` to `source/*` with `tsc-alias` | yes | no (`src/`) | no (`src/`) | yes | Yes (docs and Nanocoder) |
| Biome formatting | tabs, width 2, LF, line 80 | spaces, width 2, line 100 | tabs, width 2, LF, line 80 | tabs, width 2, LF, line 80 | Nanocoder's settings (docs, Nanocoder, Nanotune agree) |
| Biome JS style | single quotes, JSX double, semicolons, trailing commas, `{foo}` object literals, arrow parens as needed | single quotes, semicolons, trailing commas | same as Nanocoder | same as Nanocoder | Nanocoder's |
| Biome rules | preset `none`; `noUnusedVariables`, `noUnusedImports`, `useExhaustiveDependencies` error; `noExplicitAny` warn | preset `recommended` | same as Nanocoder | same as Nanocoder | Nanocoder's |
| Spec files in Biome scope | excluded | included | excluded | not stated | Included ([#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3)) |
| Husky and lint-staged | yes (`biome check --write` on staged files) | no | no | yes | Yes (docs and Nanocoder) |
| AVA through `tsx` | yes | yes | yes | yes | yes |
| AVA `serial: true` | yes | no | no | yes | yes |
| AVA `workerThreads: false` | yes | yes | yes | yes | yes |
| Spec location | `.spec.ts` beside source | `tests/**/*.test.ts` | `.spec.ts` beside source | beside source | beside source |
| c8 line threshold | 80 | via shared workflow | 80 | 80, fail on drop | 80, fail on drop |
| Knip | yes | yes | yes | yes | yes |
| Changesets | yes | yes | yes | yes | yes, with `pre enter alpha` |
| `test:format` | `biome check --no-errors-on-unmatched .` | `biome ci --formatter-enabled=true --linter-enabled=false --assist-enabled=false .` | same as prompt-scrub | same as prompt-scrub | The docs' contract |
| `CODEOWNERS` | three individuals | `@Nano-Collective/core-team` | `@Nano-Collective/core-team` | `@Nano-Collective/core-team` | `@Nano-Collective/core-team` |
| pnpm resolution policy (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`) | yes | yes | no | not documented | Yes, Suggestion (not discussed) |
| `LICENSE` file name | `LICENSE.md` | `LICENSE` | `LICENSE.md` | `LICENSE` | `LICENSE` |

Where the repositories disagree, the NC docs decide; where the docs are silent, Nanocoder is the reference ([Creating a new project][creating]).

## Electron-specific choices

Decided in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3): the picks in [this comment](https://github.com/Nano-Collective/nanocoder-desktop/issues/3#issuecomment-6412135950), with the review points in [this comment](https://github.com/Nano-Collective/nanocoder-desktop/issues/3#issuecomment-6413649344). Versions and licences are from the npm registry on 2026-10-23. Every divergence from the NC defaults goes into `CONTRIBUTING.md` ([Creating a new project][creating]).

| Choice | Pick (latest, licence) | Reason | Notes from review |
|---|---|---|---|
| Renderer bundler | `electron-vite` (6.0.0, MIT) | One config for main, preload and renderer; works with the `source/` layout | Builds to `out/`, so the `pr-checks` caller sets `build-output-dir: out` |
| Packager | `electron-builder` (26.15.3, MIT) with `electron-updater` (6.8.9, MIT) | NSIS, AppImage, `.deb`, `.dmg`, signing and GitHub Releases updates in one tool | The macOS updater needs a `.zip` artefact, so macOS ships `.dmg` and `.zip`. Installers go to `release/`, not `dist/` |
| Native module rebuilds | `electron-builder`'s built-in rebuild | No extra tool | Native `.node` files must be unpacked from the `asar` archive; check in phase S.3 |
| SQLite | `node:sqlite`, with `better-sqlite3` (13.0.3, MIT) as the fallback behind the same interface | No native module, so store tests run in plain Node | Opened an in-memory database and a WAL file in Electron 45.0.0 on Windows. Release candidate on Node 24.15 and later; still active development on Node 22, with a warning. The bundled SQLite version differs between the two (3.51.3 and 3.53.4 in the check). Store specs also run on Node 24 in CI |
| PTY | `node-pty` (1.1.0, MIT) | The standard choice | Prebuilt binaries for macOS and Windows only; Linux builds from source, so Linux contributors and the Linux release job need build tools |
| Terminal emulator | `@xterm/xterm` (6.0.0, MIT) | Has a screen-reader mode (`TERM-11`) | |
| Diff | Parse Git's own unified output | Git stays the only diff source (`GIT-04`) | The later "Agent changes" view uses `git diff --no-index` |
| Syntax highlighting | CodeMirror 6 (MIT), read-only | Selection, keyboard and screen-reader support built in; handles large files | It renders only the visible part of a document, so screen-reader checks cover file preview and diffs (`A11Y-06`) |
| End-to-end tests | Playwright (1.64.1, Apache-2.0) | `playwright-core` is already a Nanocoder dependency; can check the accessibility tree | Needs the `nodeCliInspect` fuse on. End-to-end tests run against a test build with that fuse on; the shipped build gets a smoke test that needs no inspector and a check that its fuses are set (`SEC-19`) |
| Fuses | `@electron/fuses` (2.1.3, MIT) | Needed for `SEC-19` | |
| IPC validation | `zod` 4 (MIT) | Already pulled in by the ACP SDK | |
| Lint spec files | Yes | Security tests should be linted too | Differs from Nanocoder and Nanotune; documented in `CONTRIBUTING.md` |

Not chosen: Vite with a custom main and preload build, Electron Forge, `@electron/rebuild` on its own, WebdriverIO, Shiki, and the `diff` package.

## CI implications

The shared `pr-checks` workflow runs every job on `ubuntu-latest` ([source][shared-prchecks]). macOS and Windows coverage needs local jobs in the caller, as Nanocoder does for Windows ([source][nc-prchecks]). See [`testing-strategy.md`](testing-strategy.md#cross-platform-ci).

`Verify Build` checks that `dist` is non-empty by default. `electron-vite` writes to `out/`, so the caller sets `build-output-dir: out` ([Project infrastructure][infra]).

[wp-alt]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L517-L562
[stack]: https://docs.nanocollective.org/collective/projects/stack-suggestions
[infra]: https://docs.nanocollective.org/collective/projects/project-infrastructure
[creating]: https://docs.nanocollective.org/collective/projects/creating-a-new-project
[el-releases]: https://releases.electronjs.org/release/v45.0.0
[shared-prchecks]: https://github.com/Nano-Collective/.github/blob/8d5dd13247a4a2e4a9937ef5448c89dae933d5ed/.github/workflows/pr-checks.yml
[nc-prchecks]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/.github/workflows/pr-checks.yml
