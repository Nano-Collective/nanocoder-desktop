# Risks

The whitepaper's open risks, expanded with likelihood, impact, mitigation, owner and trigger, plus the risks this plan found.

- Status: Draft
- Last updated: 2026-10-27
- Drafted by: @akramcodez

Likelihood and impact are this plan's estimates: Suggestion (not discussed). "NC core team" means `@Nano-Collective/core-team`.

## From the whitepaper

Source: [whitepaper, Open risks][wp-risks].

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger |
|---|---|---|---|---|---|---|
| RISK-01 | Durable ACP replay fails in a packaged, provider-backed restart | Low (source, tests and docs say sessions persist) | High (`SP-06`) | Technical gate; packaged restart test per release | NC core team | Gate or release test fails |
| RISK-02 | ACP capability accuracy | Medium | Medium | Version checks plus probes (`ACP-03`); conformance tests (`ACP-21`) | NC core team with Nanocoder maintainers | A call to an advertised method fails |
| RISK-03 | No supported way to add the browser tool | Medium until #116 lands | High (`SP-11`) | Nanocoder `mcpServers` change before Milestone 3 (`DEC-13`) | Nanocoder change offered by @puri-adityakumar on #116 | Change not merged when Milestone 2 exits |
| RISK-04 | Subagent events too thin for `SP-05` | High at `8a5f4d4` | Medium | Tool-card fallback (`SUB-07`); Nanocoder projection change | NC core team with Nanocoder maintainers | Milestone 1 reaches exit without child IDs |
| RISK-05 | Session discovery misses sessions (subdirectories, symlinks, case, moved projects) | Medium | Low (join key is the session ID) | Client-side matching ([`acp-integration.md`](acp-integration.md#session-discovery-and-identity)) | NC core team | Import finds fewer sessions than the CLI lists |
| RISK-06 | Process-global model state | Certain | Medium | One root turn per process (`CHAT-17`); project-level model control (`CHAT-10`) | NC core team | Any parallel-turn feature request |
| RISK-07 | Runtime packaging (Node mode versus sidecar) | Medium | High (`SP-01`) | Measure in the technical gate (`OQ-22`) | NC core team | Node mode fails on any platform |
| RISK-08 | Git cannot attribute overlapping edits without a baseline | Certain without `DEC-14` | Medium | Honest labelling (`GIT-05`); snapshot baseline (`GIT-09`) | NC core team | Users report confusing review of mixed edits |
| RISK-09 | Agent-controlled public browsing widens the attack surface | Medium | High | Off by default (`BRW-03`); mode gate and approvals (`DEC-15`) | NC core team | Public browsing enabled by default, or approvals bypassed |
| RISK-10 | PTY portability (shells, process trees, signals, encoding, ConPTY) | High | Medium | Per-platform CI (`DEC-37`); tree teardown tests (`TERM-07`) | NC core team | Orphaned processes on any platform |

## Found while planning

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger |
|---|---|---|---|---|---|---|
| RISK-11 | Nanocoder retention deletes sessions behind durable threads | High for occasional users | Medium | ViewOnly with explanation (`ACP-19`); `OQ-16` | NC core team | A thread goes view-only after 30 idle days |
| RISK-12 | Nanocoder's built-in `browser` tool bypasses the desktop's browsing policy | High once Milestone 3 ships | High | `OQ-13` | NC core team with Nanocoder maintainers | Agent reaches a public site with desktop public browsing off |
| RISK-13 | No signing identity or owner for releases | High | High (`SP-01`) | `OQ-10` | @will-lamerton (governance) | First public binary is due |
| RISK-14 | Sessions start in `auto-accept`, so edits apply without approval | Certain unless the desktop sets the mode | High (`SP-04`) | `ACP-13`, `DEC-31`: start in `normal`, and no prompt until the mode is set | NC core team | A first turn edits files without a prompt |
| RISK-15 | Desktop and Nanocoder trust disagree (first use, a changed fingerprint, another path spelling or another Nanocoder version), so ACP refuses to start | High on first use | Medium (`SP-02`) | `DEC-30`: one prompt, and Nanocoder's reason with the prompt again on refusal | NC core team | Startup exits with Nanocoder's trust message |
| RISK-16 | Build starts before Stage 4 prerequisites are recorded | Already happened (repository exists) | Low technically, real for process | `OQ-20`, `OQ-21` | @will-lamerton | Code merged before #115 and #117 are recorded |
| RISK-17 | The next Nanocoder release, which carries `session/close`, the trust check and per-session `cwd`, is late | Medium | Medium (the gate and prototype run on unreleased code) | Gate against Nanocoder `main`; ask for release timing ([proposed issue H](proposed-issues.md#h-release-timing)) | NC core team with Nanocoder maintainers | The technical gate starts before that release exists |
| RISK-18 | `node:sqlite` changes behaviour while it is a release candidate | Low | Medium (desktop store) | Store specs on Node 24; `better-sqlite3` fallback behind the same interface (`DEC-04`) | NC core team | A Node or Electron upgrade breaks the store specs |
| RISK-19 | Nanocoder's `alwaysAllow` makes `normal` skip approvals for listed tools | Medium | High (`SP-04`, `BRW-16`) | Say so in the mode control and the trust prompt; ask Nanocoder for the effective policy (`DEC-31`) | NC core team | A listed tool runs without a prompt in `normal` |

[wp-risks]: https://github.com/Nano-Collective/docs/blob/3ec3b1c6a21277556a9df3000f4e0f244e35e3bb/content/collective/whitepapers/nanocoder-desktop.md?plain=1#L635-L648
