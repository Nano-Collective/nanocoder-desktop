# Large project performance (phase 4.8)

- Status: Draft
- Last updated: 2026-11-12
- Drafted by: @akramcodez

How the desktop's file, Git and session paths behave on a large repository, how to measure them again, and the first results. The budgets are `PERF-05` to `PERF-08` in [`testing-strategy.md`](testing-strategy.md#performance-targets).

## How to measure

```bash
pnpm measure:project                         # a generated repository of about 120,000 files
pnpm measure:project --repo /path/to/repo    # a real repository
pnpm measure:project --repo /path --resume   # also open a project and resume a session with a real Nanocoder
```

Other flags: `--runs 5` (the median and range of that many runs), `--json report.json`, and `--no-fail` (without it the exit code is 1 when a budgeted measurement is over its budget).

It calls the same `FileService` and `GitService` the app uses, so what it times is the service, not a copy of it. It never writes to a repository it did not create: `PERF-08` needs a modified file, so on a real repository it uses one that is already modified and says so when there is none.

With `--resume` it starts a real Nanocoder (`NANOCODER_CLI`) with a scripted model, in a temporary configuration and data folder. It times spawn to `initialize` answered (`PERF-02`, recorded, investigate over five seconds) and resuming a saved session. Use a throwaway clone for this: Nanocoder runs in the repository, so anything it chooses to write there is its own doing.

The manual workflow `Large Project Performance` runs the same on Linux, macOS and Windows, against a generated repository or any public one by name, with the bundled Nanocoder, and keeps the report as an artefact.

## What is measured

| ID | Measurement | Budget |
|---|---|---|
| `PERF-05` | Listing the fullest directory in the repository | 300 ms |
| `PERF-06` | Previewing the largest tracked text file up to 1 MiB | 500 ms |
| `PERF-07` | Git status, with the cache cleared before every run | 5,000 ms, or `LIMIT` inside that time |
| `PERF-08` | The diff of one changed file up to 1 MiB, cache cleared before every run | 1,000 ms |
| `PERF-02` | Open the project: spawn to `initialize` answered (with `--resume`) | recorded |
| resume | Resuming a saved session (with `--resume`) | recorded |

## First results

Apple M5 Pro, 15 cores, 24 GB, macOS, Node 22.23.4, Git 2.54.0, 2026-11-12. Median of five runs.

| Measurement | Generated, 120,001 files | Linux kernel, 97,362 files |
|---|---|---|
| `PERF-05` list | 51 ms (a directory of 20,000 entries, 2,000 shown) | 8 ms (1,615 entries) |
| `PERF-06` preview | under 1 ms (960 KB) | under 1 ms (1,013,732 bytes) |
| `PERF-07` status | 154 ms | 208 ms |
| `PERF-08` diff | 170 ms (960 KB) | 220 ms |
| `PERF-02` open | not run | 281 ms |
| Resume | not run | 36 ms |

All four budgeted measurements are far inside their budgets on both repositories. The kernel is a shallow clone (`--depth 1`) of `torvalds/linux`. On a case-insensitive volume a few of its files collide and show as modified, which gave `PERF-08` a real change to diff without touching the repository.

## What these numbers do not show

- **They are one developer machine, not the reference machine, and one platform.** `PERF-01` to `PERF-08` are to be met on the reference machine on all three platforms. The workflow above produces the other two. The reference machine is for the core team to agree ([`testing-strategy.md`](testing-strategy.md#performance-targets)) and is not named yet.
- **The file cache was warm.** Git and the file system had read the tree before the first timed run. A cold start after a reboot will be slower and is not measured.
- **`PERF-06` is the service only.** The testing strategy asks for "service plus render" time. The render half is the mounted preview, which this script does not drive.
- **The real repository has no directory over the 2,000 entry cap.** Only the generated one has a 20,000 entry directory, so the "listed 2,000 of 20,000" case is proved on the fixture and not on real data.
- **The unit test for `PERF-05` allows 1,500 ms**, five times the 300 ms in the requirement, so a regression between 300 and 1,500 ms would pass CI. It is loose on purpose, because shared runners are noisy. The manual workflow is where the real budget is checked.
- **Resume here is a short session.** The 200 message resume (`PERF-03`) is measured by `replay-gates.e2e.ts`, not by this script.

## `PERF-09` and `PERF-10`

Both are recorded in [`release-and-distribution.md`](release-and-distribution.md#phase-42-behaviour): installer sizes from the CI step that prints them, and idle memory from the packaged smoke test. `PERF-09` asks for idle memory with one project open, and the recorded baseline has none, so that part is still open.
