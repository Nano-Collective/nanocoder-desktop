# Release and distribution

Prototype versus public release, bundling Nanocoder, the runtime, packaging, notices, signing and the release flow.

- Status: Draft
- Last updated: 2026-10-23
- Drafted by: @akramcodez

## Requirements

| ID | Requirement | Status and source |
|---|---|---|
| REL-01 | Prototype: resolve the user's installed Nanocoder to a trusted absolute entry point, show its version and capabilities, keep the user's provider configuration. | Decided ([whitepaper, Prototype][wp-dist]) |
| REL-02 | First public release: bundle a pinned, tested Nanocoder artefact and a compatible runtime. | Proposed (awaiting @will-lamerton) ([#117][i117]) |
| REL-03 | Advanced override to use another Nanocoder, above a minimum version, with capability gating. | Proposed (awaiting @will-lamerton) ([#117][i117]) |
| REL-04 | Choose Electron's Node mode or a bundled Node 22 sidecar by measurement on all three platforms. | Decided ([whitepaper][wp-dist]); choice Open (`OQ-22`) |
| REL-05 | Package for macOS, Windows and Linux. | Decided ([whitepaper, Engineering requirements][wp-scope]) |
| REL-06 | Ship complete third-party notices, including Nanocoder's MIT copyright and licence. | Decided ([whitepaper][wp-dist]) |
| REL-07 | Sign and notarise releases. | Required ([whitepaper][wp-threat]); how is Open (`OQ-10`) |
| REL-08 | Signed auto-update. | Required ([whitepaper][wp-threat]); channel Open (`OQ-10`) |
| REL-09 | Versioning through changesets in `alpha` prerelease mode. | Decided ([Project infrastructure][infra]) |
| REL-10 | State pre-v0.1 status publicly in the README, release notes and the app. | Decided ([How a project comes to life][lifecycle]) |
| REL-11 | Reproducible builds: frozen lockfile, exact Electron version, pinned Nanocoder artefact with its checksum recorded. | Suggestion (not discussed) |
| REL-12 | Publish installers and their SHA-256 checksums on GitHub Releases, not npm. | Suggestion (not discussed) |

## Prototype versus public release

Proposed (awaiting @will-lamerton) on [#117][i117-c]: the prototype uses the installed Nanocoder; the first public release bundles a pinned, tested version with an override for contributors; the bundled version is the supported one.

| | Prototype | Public release |
|---|---|---|
| Nanocoder | The user's install, resolved once (`REL-01`) | Bundled and pinned (`REL-02`) |
| Runtime | The user's Node, resolved once | Bundled (`REL-04`) |
| Who it is for | Contributors and testers | Anyone |
| Signing | Unsigned, and says so where it is downloaded | Signed and notarised (`REL-07`) |
| Updates | Manual | Signed auto-update (`REL-08`) |

Published Nanocoder 1.31.0 lacks `session/close`, the trust check and per-session `cwd`, which are merged but unreleased ([`acp-integration.md`](acp-integration.md#supported-nanocoder-versions)). Until the next Nanocoder release, the prototype needs a Nanocoder built from `main`, and its setup notes must say so.

## Bundling Nanocoder

Suggestion (not discussed):

1. **Pin.** Record the exact Nanocoder version and the npm tarball's integrity hash in the repository.
2. **Vendor at build time.** Install that tarball with its own production dependencies into the app's resources, separate from the desktop's `node_modules`, so the two dependency trees cannot conflict.
3. **Run with the bundled runtime.** Launch `[runtime, resources/nanocoder/dist/cli.js, "--acp"]` (`ACP-01`).
4. **Bump deliberately.** Changing the bundled version is its own pull request with a changeset, a full conformance run (`ACP-21`) and updated gate fixtures.
5. **Notices.** Nanocoder's dependency tree goes into the notices (`REL-06`).

The override (`REL-03`) points the same launcher at a user-chosen `dist/cli.js` and runtime, after the same trust checks (`SEC-05`).

## Runtime

Nanocoder needs Node 22 or newer ([source][nc-engines]).

| Option | For | Against | State |
|---|---|---|---|
| Electron's Node mode (`ELECTRON_RUN_AS_NODE`) | No second runtime. Electron 45.0.0 embeds Node 24.22.0 ([releases][el-releases]). | Keeps the `runAsNode` fuse on ([fuses][el-fuses], `SEC-19`). Nanocoder's Node version then moves with every Electron upgrade. | Viable |
| Utility process | Electron-supported child API. | Cannot write to the child's stdin ([utility process][el-utility]), so it cannot carry ACP over stdio. | Ruled out |
| Bundled Node 22 sidecar | Runtime independent of Electron upgrades; the `runAsNode` fuse can be turned off. | Larger installer; one more binary to sign and update. | Viable; the whitepaper's fallback ([whitepaper][wp-dist]) |

Phase G.6 measures both viable options (`OQ-22`).

## Packaging targets

Suggestion (not discussed), pending the packager choice (`OQ-23`):

| Platform | Format | Architectures | Notes |
|---|---|---|---|
| macOS | `.dmg` (and `.zip` if the updater needs it) | `arm64`, `x64` | Notarisation needed to open without a Gatekeeper block (`OQ-10`). |
| Windows | NSIS installer, or MSIX | `x64`, `arm64` later | Unsigned builds show SmartScreen warnings. |
| Linux | AppImage, `.deb` | `x64`, `arm64` later | Unverified: which Linux formats `electron-updater` can update in place; check electron-builder's auto-update documentation at selection time. |

Installer size and memory are measured every release (`PERF-09`, `PERF-10`), as the whitepaper asks ([whitepaper][wp-alt]).

## Third-party notices

Nanocoder and Electron are MIT licensed; the ACP SDK is Apache-2.0; `diff` is BSD-3-Clause ([`tech-stack.md`](tech-stack.md#electron-specific-choices)). Distributions keep Nanocoder's copyright and licence and include complete third-party notices ([whitepaper][wp-dist]). Suggestion (not discussed): generate notices from both lockfiles (the desktop's and the bundled Nanocoder's) at build time, ship them in the app, and fail CI when they are stale.

## Signing, notarisation and auto-update

Open ([#120][i120]). All nine sub-questions are in [`security.md`](security.md#signing-notarisation-and-update-keys). Until they are answered, any prototype binary is unsigned and must say so where it is downloaded.

## Release flow

1. Contributors add changesets; nobody bumps versions by hand.
2. `release-prepare` keeps a Version Packages pull request open.
3. Merging it bumps the version on `main`.
4. The local `release.yml` sees that the version differs from the latest GitHub Release, runs the gate, builds installers per platform (signing them once `OQ-10` is answered), uploads them with SHA-256 checksums, creates the GitHub Release with changelog notes, and notifies Discord.
5. The packaged restart-and-resume test ([`testing-strategy.md`](testing-strategy.md#packaged-restart-and-resume-test)) is run on each platform and recorded before the release is announced.

Stable 1.0 is a deliberate `changeset pre exit` followed by `changeset version` ([Project infrastructure][infra]).

## Keeping current

- **Electron.** Upgrade for every Electron security release (`SEC-14`) and record the embedded Node and Chromium versions in the release notes.
- **Nanocoder.** Bump the bundled version through the step-4 process above when a release contains fixes the desktop depends on.

## Stating pre-v0.1 status

The README, every release title and the app's about information say the project is pre-v0.1 and stability is not promised ([How a project comes to life][lifecycle]). The docs site shows an alpha badge when the project is registered with `status: "alpha"` ([`lib/projects.ts`][projects-ts]).

[wp-scope]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L102-L126
[wp-alt]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L517-L531
[wp-dist]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L564-L583
[wp-threat]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L585-L633
[lifecycle]: https://docs.nanocollective.org/collective/projects/how-a-project-comes-to-life
[infra]: https://docs.nanocollective.org/collective/projects/project-infrastructure
[projects-ts]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/lib/projects.ts
[el-fuses]: https://www.electronjs.org/docs/latest/tutorial/fuses
[el-utility]: https://www.electronjs.org/docs/latest/api/utility-process
[el-releases]: https://releases.electronjs.org/release/v45.0.0
[i117]: https://github.com/Nano-Collective/docs/issues/117
[i117-c]: https://github.com/Nano-Collective/docs/issues/117#issuecomment-6208555047
[i120]: https://github.com/Nano-Collective/docs/issues/120
[nc-engines]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/package.json#L32-L34
