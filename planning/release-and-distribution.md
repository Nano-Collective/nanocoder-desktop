# Release and distribution

Prototype versus public release, bundling Nanocoder, the runtime, packaging, notices, signing and the release flow.

- Status: Draft
- Last updated: 2026-11-11
- Drafted by: @akramcodez

## Requirements

| ID | Requirement | Status and source |
|---|---|---|
| REL-01 | Prototype: resolve the user's installed Nanocoder to a trusted absolute entry point, show its version and capabilities, keep the user's provider configuration. | Decided ([whitepaper, Prototype][wp-dist]) |
| REL-02 | First public release: bundle a pinned, tested Nanocoder artefact and a compatible runtime. | Proposed (awaiting @will-lamerton) ([#117][i117]) |
| REL-03 | Advanced override to use another Nanocoder, above a minimum version, with capability gating. | Proposed (awaiting @will-lamerton) ([#117][i117]) |
| REL-04 | Public builds bundle a pinned Node sidecar; the prototype uses the user's Node. Phase G.6 measures Electron's Node mode and the sidecar on all three platforms before the choice is final. | Proposed (awaiting @will-lamerton) (`DEC-38`, [#2](https://github.com/Nano-Collective/nanocoder-desktop/issues/2)); the whitepaper's default was Node mode ([whitepaper][wp-dist]) |
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
| Runtime | The user's Node, resolved once to an absolute path | A bundled Node sidecar (`REL-04`, `DEC-38`) |
| Who it is for | Contributors and testers | Anyone |
| Signing | Unsigned, and says so where it is downloaded | Signed and notarised (`REL-07`) |
| Updates | Manual | Signed auto-update (`REL-08`) |

Published Nanocoder 1.31.0 lacks `session/close`, the trust check and per-session `cwd`, which are merged but unreleased ([`acp-integration.md`](acp-integration.md#supported-nanocoder-versions)). Until the next Nanocoder release, the prototype needs a Nanocoder built from `main`, and its setup notes must say so.

## Bundling Nanocoder

Built in phase 4.1 ([behaviour below](#phase-41-behaviour)). The steps, as first suggested:

1. **Pin.** Record the exact Nanocoder version and the npm tarball's integrity hash in the repository.
2. **Vendor at build time.** Install that tarball with its own production dependencies into the app's resources, separate from the desktop's `node_modules`, so the two dependency trees cannot conflict.
3. **Run with the bundled runtime.** Launch `[runtime, resources/nanocoder/dist/cli.js, "--acp"]` (`ACP-01`).
4. **Bump deliberately.** Changing the bundled version is its own pull request with a changeset, a full conformance run (`ACP-21`) and updated gate fixtures.
5. **Notices.** Nanocoder's dependency tree goes into the notices (`REL-06`, phase 4.3).

The override (`REL-03`) points the same launcher at a user-chosen `dist/cli.js` and runtime, after the same trust checks (`SEC-05`).

## Runtime

Nanocoder needs Node 22 or newer ([source][nc-engines]).

| Option | For | Against | State |
|---|---|---|---|
| Electron's Node mode (`ELECTRON_RUN_AS_NODE`) | No second runtime. Electron 45.1.0 embeds Node 24.22.1 ([releases][el-releases]). | Keeps the `runAsNode` fuse on ([fuses][el-fuses], `SEC-19`), which Electron's checklist warns can let external scripts run commands through the app. Nanocoder's Node version moves with every Electron upgrade, and 24 is not the line Nanocoder's CI tests. | Viable; measured in G.6 |
| Utility process | Electron-supported child API. | Cannot write to the child's stdin ([utility process][el-utility]), so it cannot carry ACP over stdio. | Ruled out |
| Bundled Node sidecar | Runtime independent of Electron upgrades; the `runAsNode`, `nodeOptions` and `nodeCliInspect` fuses can be off. | Larger installer; one more binary to sign, notarise and update. | Proposed for public builds (`DEC-38`); the whitepaper's fallback ([whitepaper][wp-dist]) |

Proposed (awaiting @will-lamerton) in [#2](https://github.com/Nano-Collective/nanocoder-desktop/issues/2): public builds bundle the sidecar, because it is the only way to turn the `runAsNode` fuse off. The prototype has nothing to bundle and uses the user's own Node, resolved once (`REL-01`). This reverses the whitepaper's default, so the change is recorded on the whitepaper page before `OQ-22` is marked answered. Phase G.6 still measures both options before the choice is final (`OQ-22`).

### Runtime checklist

What the sidecar decision adds, from the review in [#2](https://github.com/Nano-Collective/nanocoder-desktop/issues/2). Suggestion (not discussed) for the wording; the items themselves come from the issue.

- **Which Node.** The newest LTS line that Nanocoder's CI tests, 22 today, pinned to an exact version. The version moves only when Nanocoder's CI and `engines` cover the next LTS line and the startup check in G.6 passes on all three platforms, and always before the current line reaches end of life (Node 22: 2027-04-30). Node and Electron are bumped in separate pull requests.
- **Checksums.** Download Node only from the official release, and verify its published SHA-256 for each OS and architecture before packaging, so a changed or corrupted download fails the build (`REL-11`).
- **Fuses.** Turn off `runAsNode`, `nodeOptions` and `nodeCliInspect` in the shipped build. The sidecar still honours `NODE_EXTRA_CA_CERTS` for provider calls. A packaged-build test fails if any of the three is on (`SEC-19`).
- **A clean environment.** Electron's fuses do not protect a standalone Node, and `NODE_OPTIONS` can make it run an extra script before Nanocoder starts. A packaged test starts the sidecar with `NODE_OPTIONS` set in the environment and checks that the script does not run (`SEC-05`). The desktop already drops it at launch.
- **A machine without Node.** Test the packaged app where Node, npm and npx are not installed. The sidecar runs Nanocoder, but MCP servers or hooks that call `node`, `npm` or `npx` may need extra setup. Document what works out of the box.
- **Size and signing.** The sidecar adds a 36 to 57 MB download per platform (83 to 119 MB unpacked), measured in G.6. Record the installer size it adds, and confirm the macOS entitlements the bundled Node needs under the hardened runtime with the real signing identity: the G.6 test under ad hoc signing was inconclusive.

## Phase 4.1 behaviour

- **What ships (`REL-02`, `REL-04`).** A packaged app carries a `runtime` folder in its resources: `runtime/node/node` (`node.exe` on Windows) with Node's licence beside it, and `runtime/nanocoder` holding the pinned Nanocoder and its locked production dependencies. The app runs Nanocoder only from there, by absolute path with an argument array and no shell, and never searches `PATH`. If the bundle is damaged the app says so and asks for a reinstall; it does not fall back to a Nanocoder or Node on the machine.
- **The pins (`REL-11`).** [`scripts/nanocoder-bundle.json`](../scripts/nanocoder-bundle.json) names the Nanocoder version and the SHA-512 integrity of its npm tarball. [`bundle/nanocoder`](../bundle/nanocoder/package.json) holds a `package.json` with that exact version and a committed `package-lock.json` that carries an integrity hash and a registry address for every one of its dependencies. [`scripts/node-sidecar.json`](../scripts/node-sidecar.json) pins Node and the SHA-256 of each platform's archive. `pnpm prepare:runtime` ([`prepare-runtime.mjs`](../scripts/prepare-runtime.mjs)) first checks that the lock matches the pin and that every package is hashed and from the registry, then downloads and verifies Node, installs the tree with `npm ci --omit=dev --ignore-scripts`, and checks the installed package is the pinned one. `pnpm package` and `pnpm package:dir` run it first.
- **Bumping.** Nanocoder: change the version in `bundle/nanocoder/package.json`, regenerate the lock with `npm install --package-lock-only --omit=dev --ignore-scripts --before=<the pinned release's publish time>`, copy the new tarball integrity into `scripts/nanocoder-bundle.json`, run `pnpm check:bundle-age`, move the tested version in `version-policy.ts`, and run the full ACP suite, in one pull request with a changeset. Node: take the new hashes from the release's signed `SHASUMS256.txt` under the rule in the checklist below. The two never move in the same pull request as Electron.
- **Dependency age.** The desktop's own dependencies wait seven days after release (`minimumReleaseAge` in `pnpm-workspace.yaml`), and npm applies nothing like it to the bundled tree. So the lock is generated with `--before` set to the pinned Nanocoder's publish time, which resolves every dependency as it was when that release shipped, and `pnpm check:bundle-age` reports any locked version younger than seven days. First-party `@nanocollective/` packages are exempt, as `electron` is in the pnpm policy. A first lock made without `--before` had ten transitive versions under the gate, some a day old. With it, the 1.32.0 lock has two (`ip-address` 10.7.6 and `turndown` 7.2.5, published on 4 November, the day Nanocoder 1.32.0 was); they pass the gate from 11 November. The check is run when the lock changes and is not a CI gate, because it needs the registry and moves with the clock.
- **Licences.** Nanocoder's own licence file stays in its package folder inside the bundle, and the build fails if it is missing or empty. Every dependency keeps its licence file too, because the tree is shipped as installed. The generated notices file waits for phase 4.3.
- **Override (`REL-03`).** `NANOCODER_DESKTOP_CLI` and `NANOCODER_DESKTOP_NODE` still win over the bundle, in a packaged build too. An override goes through the same checks as any other runtime: not inside the project folder, a Nanocoder at or above the minimum version, Node 22 or newer, and the version policy, so a release newer than the tested one warns and the features it does not advertise stay off. A Settings screen to choose one without environment variables waits for the Settings screen itself.
- **The tested version.** The version policy now treats the Nanocoder release the integration tests run against, 1.32.0, as supported, and any other version at or above the minimum as untested. A build that is the bundled one shows as bundled, with no warning.
- **The packaged smoke test.** `node scripts/smoke-packaged.mjs` runs in CI on every platform after packaging. It starts the app with a `PATH` that holds no Node, npm or Nanocoder. The app resolves its bundle, runs the bundled Nanocoder with the bundled Node, and shows its launcher does not pass on a poisoned `NODE_OPTIONS` (`SEC-05`), with a control showing the poison does run when handed to Node directly. The script then runs a whole turn over ACP with the bundled files against a scripted model, and checks the versions against the pins.
- **Sizes.** On macOS arm64 the bundle is about 395 MB unpacked: Node 113 MB and Nanocoder's 346 packages about 282 MB. CI prints each installer's size. Pruning the tree (documents, tests, parts of Nanocoder's dependencies that a desktop session never uses) would shrink it, and needs Nanocoder's agreement on which are safe to drop. It is not done.
- **Not in 4.1.** Fuses and installers are phase 4.2, third-party notices phase 4.3, signing, notarisation and the entitlements the bundled Node needs under the hardened runtime phase 4.4.

## Phase 4.2 behaviour

- **Fuses (`SEC-19`).** `electron-builder.yml` sets them at packaging time, and [`scripts/lib/fuses.mjs`](../scripts/lib/fuses.mjs) holds the policy and the reason for each. A spec keeps the two in step.

  | Fuse | State | Reason |
  |---|---|---|
  | `runAsNode` | off | Nothing needs Electron as a Node runtime, because Nanocoder runs under the bundled Node (`DEC-38`). Off stops `ELECTRON_RUN_AS_NODE` turning the app into a script runner. |
  | `enableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` in the environment cannot make the app load extra code. |
  | `enableNodeCliInspectArguments` | off | `--inspect` cannot attach a debugger to the shipped app. |
  | `enableEmbeddedAsarIntegrityValidation` | on | A changed `app.asar` is refused on macOS and Windows. Electron does not validate it on Linux. |
  | `onlyLoadAppFromAsar` | on | The app cannot be swapped for a folder of files. Native addons stay unpacked beside the asar. |
  | `grantFileProtocolExtraPrivileges` | off | The app loads its own `app://` scheme and never a `file://` page. |
  | `enableCookieEncryption` | off, for now | On macOS it asks for Keychain access, which wants the signed app of phase 4.4. Revisit there. |
  | `loadBrowserProcessSpecificV8Snapshot` | off | No custom snapshot is built. |

  An unsigned arm64 build also needs `resetAdHocDarwinSignature`: flipping fuses edits the Electron binary, which invalidates its ad hoc signature, and macOS then kills the app. A real signing identity (phase 4.4) re-signs it anyway.
- **The packaged-build test.** `smoke-packaged.mjs` runs on every platform. It reads the fuse wire from the packaged app and fails on any violation, then proves the three that matter by behaviour: the shipped app ignores `ELECTRON_RUN_AS_NODE` and a poisoned `NODE_OPTIONS`, while an unfused Electron runs both, so the test cannot pass because it is unable to tell. `--inspect` is checked by reading the fuse alone.
- **End-to-end tests.** They drive an unpacked Electron, where the inspector fuse stays on for Playwright (`DEC-38`), so no separate test build is needed. The one end-to-end test that touches the packaged worker forks it from the unpacked Electron and is unaffected.
- **Installer round trip (`REL-05`).** [`smoke-installer.mjs`](../scripts/smoke-installer.mjs) runs in CI after packaging and changes the machine it runs on. Linux installs the `.deb` with `apt-get install`, as a user does, so its dependencies come with it. A first version used `dpkg -i`, which stopped on two missing libraries, a failure real users avoid with `apt`. It launches the installed app, uninstalls with `dpkg -r` and checks the folder is gone. Windows runs the NSIS installer silently, launches the installed app, runs its uninstaller and checks the folder is gone. macOS mounts the `.dmg`, copies the app out, launches it, deletes it and checks no image is left mounted. Each launch starts the installed app in smoke-test mode, which checks it runs its own bundled runtime.
- **What is not covered.** Windows and Linux were not tried by hand. The automated runs cover a clean install and uninstall of a fresh machine image, and not upgrading over an older version, which has no older version to upgrade from yet.
- **`PERF-09` and `PERF-10`, first recording.** Installer sizes come from the CI step that prints them. Idle memory is the summed working set of the app's Electron processes about three seconds after the window is ready, with no project open, taken by the packaged smoke test. It is a first baseline for this release, and a rise of more than 20% against it blocks a release. It does not yet have a project open, which `PERF-09` asks for.

  | Platform | Installers | Idle memory, no project |
  |---|---|---|
  | macOS arm64 | `.dmg` 217 MB, `.zip` 221 MB | 421 MB |
  | macOS x64 | `.dmg` 226 MB, `.zip` 230 MB | 255 MB |
  | Windows x64 | NSIS `.exe` 203 MB | 312 MB |
  | Linux x64 | `.deb` 183 MB, `.AppImage` 241 MB | 533 MB |

  From [Desktop Checks on #43](https://github.com/Nano-Collective/nanocoder-desktop/actions/runs/42801676157). The memory figures come from hosted runners of different sizes and display setups, so they compare releases on one platform and not platforms with each other.

## Packaging targets

Packager decided in [#3](https://github.com/Nano-Collective/nanocoder-desktop/issues/3): `electron-builder`. Formats are a Suggestion (not discussed) except the macOS `.zip`:

| Platform | Format | Architectures | Notes |
|---|---|---|---|
| macOS | `.dmg` and `.zip` | `arm64`, `x64` | `electron-updater` updates macOS from the `.zip`. Notarisation needed to open without a Gatekeeper block (`OQ-10`). The x64 build can be made on an arm64 runner; smoke-testing it needs `macos-15-intel`. |
| Windows | NSIS installer, or MSIX | `x64`, `arm64` later | Unsigned builds show SmartScreen warnings. |
| Linux | AppImage, `.deb` | `x64`, `arm64` later | `node-pty` has no Linux prebuilt binary, so the Linux release job needs build tools. Unverified: which Linux formats `electron-updater` can update in place. |

Installer size and memory are measured every release (`PERF-09`, `PERF-10`), as the whitepaper asks ([whitepaper][wp-alt]).

## Third-party notices

Nanocoder and Electron are MIT licensed; the ACP SDK is Apache-2.0; `diff` is BSD-3-Clause ([`tech-stack.md`](tech-stack.md#electron-specific-choices)). Distributions keep Nanocoder's copyright and licence and include complete third-party notices ([whitepaper][wp-dist]). Suggestion (not discussed): generate notices from both lockfiles (the desktop's and the bundled Nanocoder's) at build time, ship them in the app, and fail CI when they are stale.

## Phase 4.3 behaviour

- **What ships (`REL-06`).** Every build carries three sets of notices.
  - [`THIRD-PARTY-NOTICES.txt`](../THIRD-PARTY-NOTICES.txt) is the desktop's. It lists the 116 packages the desktop's builds bundle or install beside the app, each with its licence, source address and licence text. That is every package the bundler pulled into the main, preload and renderer builds, the Fira Code font files, and the production dependencies that `electron-builder` copies in (the native terminal addon). It is committed, ships inside the app archive, and ships again as a plain file in the app's resources where a user can open it.
  - `runtime/THIRD-PARTY-NOTICES.txt` is the bundled runtime's. It is generated by `pnpm prepare:runtime` from the packages staged for that platform, so it lists exactly what ships there: Nanocoder first, with its own copyright and MIT licence, then its 322 dependencies on macOS arm64. The optional per-platform packages differ between platforms, so this file is not committed.
  - `runtime/node/LICENSE` is Node's own licence, which also covers what Node bundles, and Electron ships its own `LICENSE.electron.txt` and `LICENSES.chromium.html`.
- **A package with no licence file.** Some packages ship none. Its entry says so and points to the standard MIT, ISC or Apache-2.0 terms at the end of the file, and the build fails for a package whose licence has no standard terms to point to.
- **Licence policy.** [`scripts/notice-policy.json`](../scripts/notice-policy.json) lists the licences the project accepts (permissive ones, and the SIL OFL for the font). A package with no licence, a licence outside the list, or a copyleft licence fails generation, in CI and during packaging, unless it has a named exception with its reason. An exception no longer needed is reported too. A package under `A OR B` passes if either is allowed.
- **The checks.** The Notices job in Desktop Checks builds the desktop and runs `pnpm notices:check`, which fails when the committed file differs from what the build would generate, or when a licence breaks the policy. The packaged smoke test and the installer round trip both read the shipped app: the desktop notices must be present, Node's licence must be present, the runtime notices must list every package in the shipped tree, and they must contain Nanocoder's own licence text. To update the file, run `pnpm notices:generate` and commit the result.
- **One exception, open.** `cfonts` 3.3.1 is `GPL-3.0-or-later`, a dependency of `ink-big-text` in Nanocoder's production tree, which draws its terminal banner. It has shipped in the bundled runtime since phase 4.1, unmodified and as source, in a program that runs as its own process. Its licence is in the notices and the policy records it as the only exception, flagged for a decision (`OQ-26`). Nothing in 4.3 changes what ships.
- **Not in 4.3.** The notices are a text file in the app's resources, with no screen in the app that shows them. The font's licence is part of the generated file now, and the unit test that rejects drift from the font package still runs.

## Signing, notarisation and auto-update

Open ([#120][i120]). All nine sub-questions are in [`security.md`](security.md#signing-notarisation-and-update-keys). Until they are answered, any prototype binary is unsigned and must say so where it is downloaded.

## Release flow

1. Contributors add changesets; nobody bumps versions by hand.
2. `release-prepare` keeps a Version Packages pull request open.
3. Merging it bumps the version on `main`.
4. The local `release.yml` sees that the version differs from the latest GitHub Release, runs the gate, builds installers per platform (signing them once `OQ-10` is answered), uploads them with SHA-256 checksums, creates the GitHub Release with changelog notes, and notifies Discord.
5. The packaged restart-and-resume test ([`testing-strategy.md`](testing-strategy.md#packaged-restart-and-resume-test)) is run on each platform and recorded before the release is announced.

Stable 1.0 is a deliberate `changeset pre exit` followed by `changeset version` ([Project infrastructure][infra]).

## Phase 4.10 behaviour

- **What runs.** [`release.yml`](../.github/workflows/release.yml) is local, because desktop builds are installers and the shared release workflow publishes to npm. It runs on every push to `main` and does nothing unless a release is due.
- **When a release is due (`REL-09`).** `scripts/release.mjs check` reads `package.json`. It releases when the version is not `0.0.0` and `v<version>` has no GitHub Release. Merging the Version Packages pull request is the only normal way that happens. `0.0.0` is skipped so that merging this workflow cannot release an unversioned build. A version that is not plain semver stops the run, so it never reaches a shell.
- **The steps.** The gate (`pnpm test:all`) runs once on Linux. Then Linux, macOS arm64, macOS x64 and Windows each package the app, run the packaged smoke test and the installer round trip, and upload their installers. The publish job hashes every installer into `SHA256SUMS.txt` (`REL-12`), writes the notes from `CHANGELOG.md` and creates the release.
- **A failed run leaves nothing half published.** The release is created as a draft with every file attached and published last. The version check treats only a published release as done, so a failed run can be re-run: it deletes the stale draft for that tag first. The tag is created when the draft is published.
- **Notes (`REL-10`).** An alpha release is marked as a prerelease, titled "(pre-v0.1)" and opens with the pre-v0.1 notice. Every release says the installers are not signed or notarised and points to the checksums. When phase 4.4 signs the builds, that paragraph in `scripts/lib/release.mjs` changes with it.
- **Tested here, not yet run for real.** `release.spec.mjs` covers the version decision, the checksum layout, the changelog extraction and the notes, and the supply-chain spec (`SEC-18`) reads this workflow like every other. The workflow itself first runs when a Version Packages pull request merges.
- **Left for the first release.** The Discord notice waits for a webhook secret and for a decision on order, because the packaged restart-and-resume test with a real provider (step 5 above) has to be recorded before the release is announced. Signing and updates are phase 4.4 (`OQ-10`). The installers upload with a seven day retention, which is only a hand-off between jobs.

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
[el-releases]: https://releases.electronjs.org/release/v45.1.0
[i117]: https://github.com/Nano-Collective/docs/issues/117
[i117-c]: https://github.com/Nano-Collective/docs/issues/117#issuecomment-6208555047
[i120]: https://github.com/Nano-Collective/docs/issues/120
[nc-engines]: https://github.com/Nano-Collective/nanocoder/blob/8a5f4d46317d93128c531f39b80b5ac6fd2da25b/package.json#L32-L34
