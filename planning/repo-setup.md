# Repository setup

Everything to create at scaffold time, following the NC playbook, and the launch checklist. Nothing here exists yet.

- Status: Draft
- Last updated: 2026-10-26
- Drafted by: @akramcodez

## Source

[Creating a new project][creating] and [Project infrastructure][infra] (Decided). Divergences go in `CONTRIBUTING.md`.

## Target layout

To create at scaffold time:

```text
.changeset/          config.json, changelog.cjs, pre.json, README.md
.github/
  CODEOWNERS
  ISSUE_TEMPLATE/    bug_report.md, feature_request.md, config.yml
  pull_request_template.md
  nc-review/rubric.md
  workflows/         pr-checks.yml, release-prepare.yml, changeset-check.yml, nc-review.yml, release.yml, update-badges.yml
.husky/pre-commit
badges/
docs/                User-facing docs, published on docs.nanocollective.org
planning/            This planning set
source/              See architecture.md
DESIGN.md  README.md  CONTRIBUTING.md  LICENSE  package.json  pnpm-lock.yaml  pnpm-workspace.yaml
biome.json  knip.json  tsconfig.json
```

## Top-level files

### `README.md`

Intentionally empty (0 bytes) while this planning set is reviewed. At scaffold time it follows the [Brand Guidelines README pattern][brand-readme]:

1. The project name as the H1.
2. The canonical project tagline, verbatim from the [Brand Guidelines][brand-tagline], with the Nano Collective link.
3. One sentence on what the project does.
4. A clear note that the project is pre-v0.1 and stability is not promised ([How a project comes to life][lifecycle]).
5. Badges from `badges/`, quick start, usage, documentation links.
6. A section near the bottom linking the Nano Collective, the docs, the GitHub organisation and Discord.

### `CONTRIBUTING.md`

Mirror Nanocoder's. Link the Code of Conduct and Economics Charter rather than restating them, document setup, the `pnpm test:all` gate, coding standards, the release process (contributors never bump versions), every divergence from the NC defaults (including the visual identity, `DEC-36`), and link [`MAINTAINING.md`][maintaining].

### `LICENSE`

MIT, copyright "Nano Collective".

## `package.json` script contract

Exact names the shared workflow calls ([Project infrastructure][infra]):

```json
{
  "scripts": {
    "build": "…",
    "test:lint": "biome lint .",
    "test:format": "biome ci --formatter-enabled=true --linter-enabled=false --assist-enabled=false .",
    "test:types": "tsc --noEmit",
    "test:ava": "ava",
    "test:ava:coverage": "c8 --reporter=text --reporter=json-summary ava",
    "test:knip": "knip",
    "test:audit": "pnpm audit --audit-level=high --ignore-unfixable",
    "test:security": "semgrep scan --config auto --error",
    "test:all": "…runs the above…"
  }
}
```

Add `semgrep` to `ignoreBinaries` in `knip.json`.

## Workflows

| File | Kind | Notes |
|---|---|---|
| `pr-checks.yml` | Caller of `Nano-Collective/.github/.github/workflows/pr-checks.yml@main` | `validate-changesets: true`; `build-output-dir` if the bundler does not write `dist`; local macOS and Windows jobs ([`testing-strategy.md`](testing-strategy.md#cross-platform-ci)). |
| `release-prepare.yml`, `changeset-check.yml` | Callers of the shared workflows | Unchanged from other projects. |
| `nc-review.yml` | Copy of [`templates/nc-review.caller.yml`][nc-review-template] | Needs the organisation secret `MINIMAX_API_KEY`. |
| `release.yml` | Local | Desktop builds are not npm packages. Suggestion (not discussed): compare the `package.json` version with the latest GitHub Release, run the gate, build and upload installers per platform, create the release, notify Discord. Signing depends on `OQ-10`. |
| `update-badges.yml` | Local | Copy Nanocoder's; `badges/coverage.svg` is the baseline for the coverage drop check. |

## `nc-review` rubric

`.github/nc-review/rubric.md` is local and covers what a new reviewer would get wrong here: the trust boundaries in [`security.md`](security.md), IPC as a public contract, ACP handling against [`acp-integration.md`](acp-integration.md), and "never persist transcripts". Do not copy the shared base rubric.

## Changesets

Three-file scaffold: `.changeset/config.json`, `.changeset/changelog.cjs`, `@changesets/cli`. The project starts on a prerelease, so run `changeset pre enter alpha` and commit `.changeset/pre.json` in the same change that adopts changesets, and exclude `.changeset/pre.json` from Biome ([Project infrastructure][infra]).

## Rulesets and check names

Apply both rulesets with `sync-rulesets.sh` from the `.github` repository, in `evaluate` mode first, only after the checks report. Required status checks use the prefixed names:

```text
pr-checks / Linting
pr-checks / Type Checks
pr-checks / Format Checks
pr-checks / Unused Dependencies
pr-checks / Unit Tests & Coverage Analysis
pr-checks / Verify Build
```

Do not require `Changeset Validation`.

## `CODEOWNERS`

```text
* @Nano-Collective/core-team
```

## Templates

Bug report (description, environment including OS and Nanocoder version, steps, expected and actual behaviour, logs, duplicate check), feature request (including alignment with local-first and privacy-respecting values), and a PR template ([Creating a new project][creating]).

## Commit messages

`feat:`, `fix:`, `mod:`, `chore(deps):`, `docs:`, optional scope, lowercase, imperative, no trailing period, `release: vX.Y.Z` for releases ([Creating a new project][creating]).

## Future `docs/`

```text
docs/
  index.md            Project name, tagline, one sentence
  community.md
  getting-started/    index.md, installation.md, setup.md
  features/           index.md, one page per feature
```

Every page has `title`, `description` and `sidebar_order` frontmatter. Registering the project in the docs site's [`lib/projects.ts`][projects-ts] with `status: "alpha"` and `includePrereleases: true` publishes `docs/` from release tags.

## Launch checklist

From [Creating a new project][creating]:

- [ ] `README.md` with the required sections, opening with the canonical tagline
- [ ] `CONTRIBUTING.md` links the Code of Conduct and Charter rather than redefining them
- [ ] `LICENSE` (MIT, "Nano Collective")
- [ ] Linting and formatting set up
- [ ] Test suite with at least a smoke test, full gate passing
- [ ] Dead code detection (Knip)
- [ ] Package security audit (`pnpm audit`)
- [ ] Security scanning (Semgrep, CodeQL)
- [ ] CI workflows: `pr-checks.yml` caller, `release.yml`, `update-badges.yml`
- [ ] Both rulesets applied, six required checks green
- [ ] `CODEOWNERS` naming `@Nano-Collective/core-team`
- [ ] Changesets scaffolded, `pre.json` committed
- [ ] Issue templates (bug, feature) and PR template
- [ ] `docs/` with at least `index.md` and `getting-started/`
- [ ] Badges point to real endpoints
- [ ] At least one release published so the install path is proven
- [ ] Project listed on the Nano Collective website
- [ ] Announced in Discord

[creating]: https://docs.nanocollective.org/collective/projects/creating-a-new-project
[infra]: https://docs.nanocollective.org/collective/projects/project-infrastructure
[lifecycle]: https://docs.nanocollective.org/collective/projects/how-a-project-comes-to-life
[brand-readme]: https://docs.nanocollective.org/collective/organisation/brand#readmemd
[brand-tagline]: https://docs.nanocollective.org/collective/organisation/brand#the-canonical-project-tagline
[maintaining]: https://github.com/Nano-Collective/.github/blob/main/MAINTAINING.md
[nc-review-template]: https://github.com/Nano-Collective/.github/blob/main/templates/nc-review.caller.yml
[projects-ts]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/lib/projects.ts
