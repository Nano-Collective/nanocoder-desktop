# Issue #68 evidence

All evidence here was captured in the Instabox Debian 13 x64 sandbox with the
fake Nanocoder fixture and synthetic repository changes only.

## Visible QA

- Native visible Electron launch with agent-browser over CDP on port 9334.
- The review panel showed the changed-file list and the selected README diff
  together.
- The selected row carried a fake comment draft, proving the review form was
  present in the visible build.
- [Selected review diff screenshot](review-selected-linux.png)

## Performance

Five fresh built-app runs used 2,505 replaced lines, 5,015 parsed rows before
the existing 5,000-row cap, and the same explicit file selection and keyboard
End navigation in every run. The virtualised build mounted 24 rows in every
run. Raw output is in [performance.log](performance.log).

| Median of five | Result |
|---|---:|
| First render | 142.5 ms |
| Keyboard scroll to capped last row | 35.3 ms |
| Mounted rows | 24 |

## Automated status

- `pnpm build`: pass in Instabox.
- `xvfb-run -a pnpm exec playwright test e2e/files.e2e.ts e2e/accessibility.e2e.ts --workers=1`: 31 passed.
- `xvfb-run -a pnpm exec playwright test e2e/review-performance.e2e.ts --repeat-each=5 --workers=1`: 5 passed.
- Focused renderer tests: 26 passed.
- Focused ACP/thread isolation rerun: 259 passed.
- `pnpm test:format`, `pnpm test:types`, `pnpm test:lint`, `pnpm test:knip` and `pnpm test:audit`: pass when run independently.
- The full gate is blocked by four existing runtime-check tests that call
  `chmod` on sandbox temporary files and receive `EPERM`; moving `TMPDIR` to
  `/tmp` and `/var/tmp` does not change that restriction. One concurrent
  `TERM-07` process-tree test also failed while the full suite was running but
  passed in isolation. No issue-#68 test failed.

The final build, Electron QA, computer-use run and screenshots were run in
Instabox Linux. Local macOS execution is not treated as cross-platform proof;
Windows and macOS remain CI/manual limitations.
