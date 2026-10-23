# Tech stack

The decided stack, the NC toolchain defaults as they exist in Nanocoder, prompt-scrub and Nanotune, and the Electron-specific choices still open.

- Status: Draft
- Last updated: 2026-10-23
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
| Spec files in Biome scope | excluded | included | excluded | not stated | Open: excluding them means tests are not linted |
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

The NC defaults do not cover these. All Open (`OQ-05`, `OQ-23`). Versions and licences are from the npm registry on 2026-10-23. Whatever is chosen, any divergence from the NC defaults is documented in `CONTRIBUTING.md` ([Creating a new project][creating]).

| Choice | Candidates (latest, licence) | Trade-offs |
|---|---|---|
| Renderer bundler | `electron-vite` (6.0.0, MIT); `vite` (8.3.5, MIT) with a custom main and preload build; Electron Forge's Vite plugin | `electron-vite` handles main, preload and renderer in one config but expects its own folder layout; plain Vite keeps the `source/` layout at the cost of more setup. |
| Packager | `@electron-forge/cli` (8.0.1, MIT); `electron-builder` (26.15.3, MIT) | Forge is maintained under the Electron organisation; `electron-builder` has broad target support and pairs with `electron-updater` (6.8.9, MIT). The update choice (`OQ-10`) may decide this. |
| Fuses | `@electron/fuses` (2.1.3, MIT) | Needed for `SEC-19` whichever packager is used. |
| End-to-end tests | `playwright` (1.64.1, Apache-2.0); `webdriverio` (10.1.0, MIT) | `playwright-core` is already in Nanocoder's dependency tree. Unverified: how well Playwright's Electron support drives a packaged app; a spike in phase S.3 would confirm. |
| Native module rebuilds | `@electron/rebuild` (4.2.1, MIT); the packager's built-in rebuild; prebuilt binaries | `node-pty` and `better-sqlite3` are native and must match Electron's ABI. Prebuilt downloads add supply-chain surface (`SEC-18`). |
| PTY | `node-pty` (1.1.0, MIT) | The common choice; native; Windows uses ConPTY. |
| Terminal emulator | `@xterm/xterm` (6.0.0, MIT) | Has a screen-reader mode (`TERM-11`). |
| SQLite | `better-sqlite3` (13.0.3, MIT); Node's built-in `node:sqlite` | See [`data-model.md`](data-model.md#sqlite-library). |
| Diff | Git's own unified output parsed directly; `diff` (9.0.0, BSD-3-Clause, already a Nanocoder dependency) | Parsing Git's output keeps one source of truth (`GIT-04`). BSD-3-Clause needs its notice in third-party notices (`REL-06`). |
| Syntax highlighting | `shiki` (4.5.0, MIT); `codemirror` (6.0.2, MIT) in read-only mode | Shiki produces static output; CodeMirror brings selection and keyboard handling useful for `GIT-07` and `A11Y-01`. |
| Runtime IPC validation | `zod` (4.6.7, MIT; Nanocoder resolves 4.6.5 through the ACP SDK) | Avoids a second schema library. |

## CI implications

The shared `pr-checks` workflow runs every job on `ubuntu-latest` ([source][shared-prchecks]). macOS and Windows coverage needs local jobs in the caller, as Nanocoder does for Windows ([source][nc-prchecks]). See [`testing-strategy.md`](testing-strategy.md#cross-platform-ci).

`Verify Build` checks that `dist` is non-empty by default; if the bundler writes elsewhere, set `build-output-dir` ([Project infrastructure][infra]).

[wp-alt]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L517-L562
[stack]: https://docs.nanocollective.org/collective/projects/stack-suggestions
[infra]: https://docs.nanocollective.org/collective/projects/project-infrastructure
[creating]: https://docs.nanocollective.org/collective/projects/creating-a-new-project
[el-releases]: https://releases.electronjs.org/release/v45.0.0
[shared-prchecks]: https://github.com/Nano-Collective/.github/blob/8d5dd13247a4a2e4a9937ef5448c89dae933d5ed/.github/workflows/pr-checks.yml
[nc-prchecks]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/.github/workflows/pr-checks.yml
